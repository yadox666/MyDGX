INFORME TÉCNICO / SISTEMAS LOCALES DE IA

Modelos locales de IA  
para DGX Spark

Evaluación técnica de 25 modelos GGUF: ciberseguridad, programación, razonamiento, visión y uso general; perfiles para ARTIFEX, OpenCode y RAGKit.

**DGX SPARK · NVIDIA GB10 · 128 GB DE MEMORIA UNIFICADA**

Edición: 21 de noviembre de 2026 · **revisada con mediciones en el DGX Spark**

> **EDICIÓN MEDIDA**
> Donde esta edición da velocidades, memoria o compatibilidad de MTP, son mediciones hechas en el propio DGX Spark el 21 de noviembre de 2026, con llama.cpp `v1.0.0` (y `b10679` donde se indica). Sustituyen a las estimaciones y recomendaciones del informe original. La calidad de las respuestas sigue sin medir: la batería de 100 casos continúa pendiente.

**Inventario de ciberseguridad:** **8** modelos · **112 GB** de pesos · **7 GB** de archivos auxiliares · **119 GB** en total.


> **CONCLUSIÓN PARTE I / CIBERSEGURIDAD**
> Cyber-Tiel Q6 destaca como motor técnico para código y automatización; BugHunter v7 para seguridad web y bug bounty; OrcaCyber Nano para defensa, ingeniería inversa y visión; Bimo CyberAgent como candidato para agentes ligeros con herramientas.


Documento de análisis operativo. Las cifras de benchmarks señaladas como «del desarrollador» no constituyen validación independiente en el DGX Spark.

# Resumen ejecutivo

Tu colección reúne ocho modelos especializados en ciberseguridad, con 112 GB aproximados de pesos principales y 7 GB de archivos auxiliares. Todos los GGUF principales caben individualmente en los 128 GB de memoria unificada del DGX Spark, pero no es recomendable mantenerlos cargados a la vez.

La selección es heterogénea: modelos orientados a programación, investigación de vulnerabilidades, defensa, visión y uso de herramientas. Por eso es más útil asignar roles que escoger un ganador absoluto.

> **RECOMENDACIÓN PARA ARTIFEX (MEDIDA)**
> BugHunter v8 y Cyber-Tiel Q5 ya están descargados y probados. Para velocidad, Cyber-Tiel Q5 con su drafter MTP (75–90 tok/s) supera a Q6 (~61 tok/s; 58–74 con MTP) con 4,8 GiB menos de memoria; Q6 queda como referencia de calidad. BugHunter v8 escribe a ~78–80 tok/s frente a ~13 de v7 (~31 con su MTP integrado). OrcaCyber Nano entra mejor sin visión y con MTP; Bimo queda fuera de los perfiles simultáneos: solo llega a 32K de contexto y es el más lento (~31 tok/s).


## Orden de utilidad general recomendado

| **Orden** | **Modelo**                   | **Mayor aportación**                             |
|-----------|------------------------------|--------------------------------------------------|
| 1         | Cyber-Tiel Coder 35B-A3B     | Auditoría de código, CTF, automatización técnica |
| 2         | BugHunter v7 27B             | Bug bounty, pentesting web/API, informes         |
| 3         | OrcaCyber Nano 27B           | Blue team, DFIR, ingeniería inversa y capturas   |
| 4         | Bimo 7B CyberAgent           | Llamadas a herramientas y flujos repetitivos     |
| 5         | Qwen3.8 27B Uncensored Cyber | Segunda opinión y razonamiento técnico general   |
| 6         | BaronLLM v2 Qwen3 14B        | Conocimiento, normas y threat intelligence       |
| 7         | BaronLLM Llama 3.1 8B        | Consultas rápidas y apoyo básico                 |
| 8         | Huihui Qwen3.5 0.8B          | Clasificación simple y experimentación           |

La clasificación es una valoración técnica basada en propósito, ajuste declarado y evidencia pública. No es el resultado de una prueba uniforme realizada sobre tu equipo. En aplicaciones web BugHunter puede ocupar el primer puesto; en DFIR y visión puede hacerlo OrcaCyber.

# 1. Inventario de modelos descargados

Ubicación declarada de los archivos: ~/.cache/huggingface/hub. Los tamaños son aproximados y están expresados como ocupación en disco, no como memoria necesaria durante la inferencia.

| **Modelo / proveedor** | **Archivo GGUF principal** | **GB** | **Archivos adicionales** |
| --- | --- | --- | --- |
| Cyber-Tiel 35B-A3B · peculiar-ragdoll | Cyber-Tiel-Coder-35B-A3B-UD-Q6_K_XL.gguf | 31,8 | — |
| Qwen3.8 Cyber 27B · philbert440 | Qwen3.8-27B-Uncensored-Cyber-Q6_K.gguf | 23,7 | MTP 3,2 GB; mmproj 0,6 GB |
| BugHunter v7 27B · mmp2055 | Qwen3.8-27B-Uncensored.Q4_K_M.gguf | 16,8 | — |
| OrcaCyber Nano · orcarouter | OrcaCyber-Nano-1.0-AI-Defense-Mix-15.7G.gguf | 15,7 | DFlash2 2,1 GB; mmproj 0,9 GB |
| BaronLLM v2 14B · AlicanKiraz0 | qwen3-14b-baronllm-v2-q4_0.gguf | 8,5 | — |
| Bimo CyberAgent 7B · mradermacher | Bimo-7B-CyberAgent.Q8_0.gguf | 8,1 | — |
| BaronLLM Offensive 8B · AlicanKiraz0 | baronllm-llama3.1-v1-q6_k.gguf | 6,6 | — |
| Huihui Qwen3.5 0.8B · azminawwar | Huihui-Qwen3.5-0.8B-abliterated.Q8_0.gguf | 0,8 | mmproj 0,2 GB |


**Descargados después del inventario.** BugHunter v8 Q4_K_M (21,2 GB), Cyber-Tiel UD-Q5_K_XL (26,6 GB), el drafter MTP de Cyber-Tiel `mtp-Cyber-Tiel-Coder-35B-A3B.gguf` (1,48 GB, sirve para Q5 y Q6) y Qwen3-Coder-Next abliterated Q4_K_M (48,6 GB). El perfil «ARTIFEX · Cyber-Tiel Q6» usa ya el drafter, en el puerto 18081 que espera ARTIFEX.

**Fuera del alcance del inventario.** Los modelos generalistas uncensored/abliterated, como Dolphin, Heretic o GPT-OSS Derestricted, se han excluido de esta clasificación específica de ciberseguridad.

# 2. Ficha comparativa de arquitectura y contexto

| **Modelo**     | **Parámetros aprox.**  | **GGUF local** | **Contexto declarado¹** | **Visión en tu copia** |
|----------------|------------------------|----------------|-------------------------|------------------------|
| Cyber-Tiel     | 35B / 3B activos (MoE) | UD-Q6_K_XL     | 262K                    | No, falta mmproj       |
| Qwen Cyber     | 27B denso              | Q6_K           | 262K (base)             | Sí                     |
| BugHunter v7   | 27B denso              | Q4_K_M         | 32K recomendado         | No, falta mmproj       |
| OrcaCyber Nano | 27B denso              | Mix / 15,7 GB  | 262K                    | Sí                     |
| BaronLLM v2    | 14B denso              | Q4_0           | 8K                      | No                     |
| Bimo           | 7,62B denso            | Q8_0           | 32K con YaRN            | No                     |
| BaronLLM Llama | 8B denso               | Q6_K           | 8K ajuste               | No                     |
| Huihui         | 0,8B                   | Q8_0           | No verificado           | Sí                     |

¹ El contexto publicado es un límite anunciado o configurado, no una garantía de precisión o velocidad en ese máximo. Empezar en 16K–32K y medir resulta más prudente para las cargas reales de seguridad.

# 3. Evaluación individual de los modelos

## 3.1 Cyber-Tiel Coder 35B-A3B Q6 · Motor técnico principal

Repositorio: peculiar-ragdoll/Cyber-Tiel-Coder-35B-A3B-GGUF \[F1\]

Modelo Mixture of Experts basado en Ornith-1.5 mediante una versión abliterated de Huihui, con aproximadamente 35B parámetros totales y 3B activos por token. El autor utiliza una imatrix con material de seguridad para orientar la cuantización, además de una plantilla de conversación pensada para programación y herramientas.

**Ventajas.** Muy buen encaje en análisis de repositorios, revisión de rutas vulnerables, generación de parches y tests, automatización de programación, CTF y trabajos de laboratorio autorizados. La descarga Q6 ofrece una cuantización relativamente conservadora.

**Evidencia.** El desarrollador comunica 13,7 de 25 tareas de SWE-bench-Live como promedio de tres ejecuciones; y 15/43 desafíos resueltos en una selección ampliada de Cybench, incluidos 10/31 de las tareas oficiales disponibles. Esos resultados son autorreportados y se refieren principalmente a Q4, no al GGUF Q6 del Spark.

**Limitaciones.** Parte de la orientación “Cyber” se consigue mediante abliteration, calibración de cuantización y prompting, no mediante un nuevo entrenamiento exhaustivo. El autor declara sacrificios en conocimiento general. No tienes instalado su proyector de visión.

**Papel propuesto.** Analista principal de código, motor de programación y agente técnico supervisado de ARTIFEX.

## 3.2 BugHunter v7 Qwen3.8 27B Q4 · Bug bounty y seguridad web

Repositorio: mmp2055/Qwen3.8-27B-Uncensored-bughunter-v7 \[F2\]

El desarrollador documenta un ajuste QLoRA orientado al flujo de investigación de vulnerabilidades: alrededor de 15.611 unidades de conocimiento, 14.914 ejemplos de entrenamiento, 466 de validación y 309 de prueba. Declara LoRA de rango 8, alfa 16, una época, tasa 1e-5 y unos 39,8 millones de parámetros entrenables (aprox. 0,15 % de un modelo de 27,4B).

**Ventajas.** Especialización declarada en autenticación y autorización, SSRF, deserialización, lógica de negocio, seguridad web y API, metodología bug bounty, tráfico, DFIR y elaboración de informes técnicos. Responde en español, manteniendo la terminología especializada y los comandos en inglés.

**Limitaciones.** El autor advierte que la llamada a herramientas es débil al no haber entrenado ejemplos específicos de tool calling. El corpus se concentra más en web/API que en ICS/SCADA o hardware. La cuantización Q4_K_M conserva menos precisión que Q6. No existe evidencia independiente suficiente de su tasa de descubrimiento de fallos reales.

**Papel propuesto.** Especialista de bug bounty, pentesting web/API y preparación de informes; puede ser primera opción en estos casos.

## 3.3 OrcaCyber Nano 1.0 · Blue team y visión

Repositorio: orcarouter/OrcaCyber-Nano-1.0 \[F3\]

Derivado de Qwen3.8-27B, presentado como asistente de seguridad defensiva, ingeniería inversa, auditoría de código, análisis de logs y respuesta a incidentes. Tu copia incluye pesos principales de 15,7 GB, proyector visual de unos 0,9 GB y un DFlash2 de 2,1 GB; la ficha también menciona soporte MTP.

**Ventajas.** Permite combinar texto con imágenes para revisar capturas de Ghidra o IDA, diagramas de red, alertas, registros, pantallas de escáner y fragmentos de desensamblado. Es el mejor complemento defensivo a Cyber-Tiel y BugHunter dentro del inventario.

**Limitaciones.** El autor anuncia cifras generales elevadas —incluido 78,4 % en SWE-bench— mientras indica que todavía está completando metodología y tablas. No está demostrado que supere a los demás en un benchmark común de seguridad. El repositorio declara licencia qwen y requiere revisar los términos antes de uso comercial.

**Papel propuesto.** Analista de respuesta a incidentes e ingeniería inversa, con prioridad cuando existan imágenes o capturas técnicas.

## 3.4 Bimo 7B CyberAgent Q8 · Agente ligero de herramientas

Repositorios: iBimo-o/Bimo-7B-CyberAgent \[F4\] y mradermacher/Bimo-7B-CyberAgent-GGUF \[F5\]

Ajuste de Qwen2.5-Coder-7B-Instruct: cuatro etapas QLoRA declaradas para conocimiento de ciberseguridad, trayectorias de agente, llamadas a funciones y extensión de contexto por YaRN. Configuración: 7.615.616.512 parámetros; 28 capas; dimensión 3.584; 28 cabezas de consulta y 4 KV. Declara 32K de contexto extendido.

**Ventajas.** Orientación explícita a la estructura de invocaciones JSON y su continuación tras recibir resultados. Buena opción para clasificar eventos, consultar inventarios, interpretar salidas de escáneres y ejecutar procedimientos de solo lectura. El archivo Q8 reduce pérdida por cuantización.

**Evidencia.** El autor compara Bimo con su modelo base: MMLU Computer Security 73 % frente a 64 %; MMLU general 63,87 % frente a 67,6 %; GSM8K 56,8 % frente a 83,9 %; frecuencia de invocación de herramientas 89,5 % frente a 12,5 %. Son cifras de BF16 y no prueban la corrección de cada llamada.

**Limitaciones.** La especialización parece reducir razonamiento general; puede inventar CVEs o versiones. El contexto YaRN debe medirse y las llamadas a herramientas validarse antes de ejecutarse.

**Papel propuesto.** Agente auxiliar de ARTIFEX con permisos acotados, preferentemente solo lectura y JSON validado por esquema.

## 3.5 Qwen3.8 27B Uncensored Cyber Q6 · Revisor generalista

Repositorio: philbert440/Qwen3.8-27B-Uncensored-Cyber-GGUF \[F6\]

Es una modificación de Qwen3.8-27B centrada en reducir rechazos, especialmente frente a consultas de ciberseguridad ofensiva. Tu copia contiene el modelo Q6_K, un MTP de 3,2 GB y un proyector de 0,6 GB.

**Ventajas.** Base densa de 27B, cuantización Q6 y capacidad de entrada visual. Puede aportar una perspectiva independiente para revisar hallazgos, explicaciones técnicas, configuraciones, arquitectura y código.

**Evidencia y límite.** La ficha anuncia 100/100 respuestas sin rechazo a preguntas de ciberseguridad (frente a 93/100 previas). Esa prueba mide rechazo, no descubrimiento correcto de vulnerabilidades ni precisión de análisis.

**Papel propuesto.** Revisor de segunda opinión, respaldo generalista y apoyo multimodal.

## 3.6 BaronLLM v2 Qwen3 14B Q4 · Conocimiento y normativa

Repositorio: AlicanKiraz0/Qwen3-14B-BaronLLM-v2-Q4_0-GGUF \[F7\]

Su autor describe un ajuste con 53.202 ejemplos de ciberseguridad y más de 200 áreas, desde cloud, DevSecOps y redes hasta inteligencia de amenazas, respuesta a incidentes y cumplimiento normativo. Publica un 80,93 % agregado en CS-Eval; entre sus desglose, 87,2 % en normas, 85,5 % en seguridad de aplicaciones y 88,1 % en endpoints. Son resultados de autor cuya reproducción en este GGUF no está documentada.

**Ventajas.** Fuerte encaje declarado en documentación, explicación de marcos ATT&CK, procedimientos SOC, categorización de hallazgos, preparación de políticas e interpretación de configuraciones.

**Limitaciones.** El ajuste declara 8.192 tokens de longitud de secuencia. La cuantización Q4_0 es menos conservadora que K-quants modernos. No lo escogería para análisis extensos de repositorios.

**Papel propuesto.** Asistente de conocimiento y redacción, siempre con referencias contrastadas.

## 3.7 BaronLLM Offensive Security Llama 3.1 8B Q6 · Apoyo básico

Repositorio: AlicanKiraz0/Cybersecurity-BaronLLM_Offensive_Security_LLM_Q6_K_GGUF \[F8\]

Variante de Llama 3.1 8B Instruct ajustada para tareas ofensivas. La ficha menciona documentación de vulnerabilidades, informes de investigadores y escenarios ATT&CK; declara 8K de secuencia.

**Ventajas.** Huella moderada, Q6 y utilidad potencial para preguntas rápidas, vulnerabilidades conocidas y resúmenes de hallazgos.

**Limitaciones.** Menor capacidad de base que tus modelos grandes. La documentación del repositorio contiene referencias poco consistentes a otros tamaños de modelo. La licencia base de Llama 3.1 debe revisarse, aunque la ficha del derivado muestre MIT.

**Papel propuesto.** Respaldo de baja carga, no analista principal.

## 3.8 Huihui Qwen3.5 0.8B Offensive Red Team Q8 · Experimental

Repositorio: azminawwar/huihui-ai_Huihui-Qwen3.5-0.8B-abliterated_Ultimate-Offensive-Red-Team \[F9\]

Modelo pequeño con modificación abliterated y orientación ofensiva declarada. El publicador afirma haberlo ajustado y convertido con Unsloth, pero no presenta un corpus o una evaluación de seguridad suficientemente detallados como para verificar su rendimiento.

**Ventajas.** Apenas 0,8 GB de pesos, proyector visual adicional de 0,2 GB; apto para experimentos de clasificación, extracción de campos, enrutamiento simple y tareas auxiliares rápidas.

**Limitaciones.** Su tamaño restringe gravemente la capacidad de razonamiento en investigaciones complejas. No hay benchmarks convincentes de desempeño profesional, ni es apropiado para decidir acciones autónomas sensibles.

**Papel propuesto.** Clasificador experimental únicamente después de superar pruebas con datos propios.

# 4. Matriz de selección por especialidad

Asignación práctica recomendada; el modelo secundario proporciona contraste y no sustituye la validación con evidencias.

| **Actividad**                        | **Modelo principal** | **Segunda opinión**     |
|--------------------------------------|----------------------|-------------------------|
| Auditoría de código                  | Cyber-Tiel           | Qwen Cyber              |
| Seguridad web y API                  | BugHunter v7         | Cyber-Tiel              |
| Bug bounty e informes                | BugHunter v7         | Qwen Cyber              |
| CTF y laboratorio autorizado         | Cyber-Tiel           | BugHunter v7            |
| Ingeniería inversa / desensamblado   | OrcaCyber Nano       | Cyber-Tiel              |
| Capturas, diagramas, GUIs técnicas   | OrcaCyber Nano       | Qwen Cyber              |
| Análisis de logs / DFIR              | OrcaCyber Nano       | BugHunter v7            |
| Threat hunting / incidentes          | OrcaCyber Nano       | BaronLLM v2             |
| Normativa / políticas / cumplimiento | BaronLLM v2          | OrcaCyber Nano          |
| Invocación de herramientas / JSON    | Bimo                 | Cyber-Tiel              |
| Verificación cruzada de hallazgos    | Qwen Cyber           | Cyber-Tiel              |
| Clasificación ligera                 | Bimo                 | Huihui (solo si valida) |

# 5. Evidencia comparada y límites de evaluación

No hay benchmark único, independiente y reproducido para los ocho modelos en el mismo hardware. Por eso los porcentajes de SWE-bench, Cybench, CS-Eval, pruebas de rechazo y herramientas no son intercambiables.

| **Modelo**     | **Evidencia pública resumida**             | **Lectura técnica**                                       |
|----------------|--------------------------------------------|-----------------------------------------------------------|
| Cyber-Tiel     | SWE-bench-Live y Cybench del autor         | Señal útil de código/CTF; sin réplica local Q6            |
| BugHunter v7   | Corpus e hiperparámetros bien descritos    | Transparencia de ajuste; falta medición de hallazgos      |
| OrcaCyber Nano | Benchmarks generales en ficha              | Sin validación sólida comparativa específica de seguridad |
| Bimo           | MMLU Security y frecuencia de herramientas | Indicio de especialización; falta éxito funcional         |
| BaronLLM v2    | CS-Eval y SecBench declarados              | Prometedor; sin reproducción independiente del GGUF       |
| Qwen Cyber     | 100/100 sin rechazo                        | Mide disposición a responder, no exactitud técnica        |
| BaronLLM 8B    | Casos de uso declarados                    | Evidencia comparativa limitada                            |
| Huihui 0.8B    | Sin batería sustancial localizada          | Evidencia insuficiente para tareas críticas               |

> **CÓMO LEER UN BENCHMARK**
> El 35 % de Cyber-Tiel en la selección ampliada de Cybench no se compara directamente con el 80,93 % CS-Eval publicado por BaronLLM. Evalúan habilidades, muestras y criterios diferentes. Tampoco debe interpretarse una elevada tasa sin rechazo como precisión al identificar fallos.


# 6. Operación eficiente sobre DGX Spark

## 6.1 Memoria, peso en disco y concurrencia

La suma de pesos GGUF principales alcanza 112 GB; sus archivos auxiliares suponen otros 7 GB. Estos tamaños no incluyen caches KV, buffers, memoria del servidor de inferencia, sistema operativo y herramientas. Mantener ocho modelos cargados de forma permanente consumiría prácticamente toda la memoria y perjudicaría la estabilidad.

**Política recomendada.** Cargar bajo demanda el motor principal de cada especialidad y reservar margen para Linux, herramientas, contexto y procesos concurrentes. Medir el consumo de memoria real antes de fijar el número de contextos o sesiones simultáneas.

## 6.2 Qué hacen MTP, DFlash2 y mmproj

| **Componente** | **Función**                                         | **Precaución**                                                         |
|----------------|-----------------------------------------------------|------------------------------------------------------------------------|
| mmproj         | Conecta la entrada de imágenes al modelo multimodal | Requiere soporte del modelo y del runtime; no mejora texto por sí solo |
| MTP            | Propone tokens para decodificación especulativa     | Aceleración condicionada por compatibilidad y aceptación               |
| DFlash2        | Drafter alternativo para propuestas especulativas   | No se debe sumar mecánicamente con MTP                                 |

**Medido en el GB10** (prompt de auditoría de código, 256 tokens, un modelo cada vez):

| **Modelo** | **Sin especulativa** | **Con MTP** | **Aceptación / nota** |
|---|---|---|---|
| Cyber-Tiel Q5 + drafter `mtp-*.gguf` | 63–64 tok/s | 70–92 tok/s | 68 % con `b10679` |
| Cyber-Tiel Q6 + el mismo drafter | ~61 tok/s | 58–74 tok/s | ganancia pequeña, depende del prompt |
| BugHunter v7 (MTP en el GGUF) | ~10–13 tok/s | 23–31 tok/s | 75 % |
| OrcaCyber Nano (MTP en el GGUF) | — | 23–33 tok/s | 73 % |
| DeepSeek-V4-Pro / Qwen3.5 9B (MTP en el GGUF) | — | 30–49 tok/s | 55–65 % |
| BugHunter v8 | 78–80 tok/s | — | sin capas MTP (`nextn_predict_layers=0`) |
| Qwen3-Coder-Next Q4_K_M | ~50 tok/s | — | sin MTP ni drafter de vocabulario compatible |

Tres reglas confirmadas: un drafter MTP solo sirve para el modelo con el que se entrenó (el de Cyber-Tiel no vale para v8, aunque compartan arquitectura); el drafter debe compartir vocabulario con el modelo principal; y llama.cpp no combina decodificación especulativa con `mmproj`, así que en OrcaCyber y el 9B hay que elegir entre MTP y visión. DFlash2 de OrcaCyber sigue sin medir.

## 6.3 Seguridad de los agentes

Un modelo uncensored no es necesariamente más fiable ni exacto. Cuando ARTIFEX u OpenCode tienen acceso a shell, archivos o red, conviene aplicar límites a las herramientas independientemente del modelo: permisos de solo lectura por defecto, entornos aislados para ensayos, validación de parámetros, confirmación antes de cambios destructivos y registro de acciones.

La ejecución de pruebas debe limitarse a laboratorios o sistemas con autorización explícita. Para casos reales, los hallazgos deberían confirmarse mediante pruebas reproducibles, evidencia técnica y revisión humana, en lugar de confiar en una respuesta aislada del LLM.

# 7. Propuesta de evaluación local: 100 casos

Una batería común es la forma más fiable de decidir qué modelo se convierte en principal, secundario o prescindible. Los siguientes números son una distribución propuesta de pruebas; no representan resultados ya obtenidos.

| **Área de pruebas**              | **N.º de casos** | **Verificación de calidad**                        |
|----------------------------------|------------------|----------------------------------------------------|
| Código vulnerable conocido       | 25               | Identificación, localización y parche comprobable  |
| Web/API y casos bug bounty       | 20               | Hallazgo reproducible y severidad proporcionada    |
| Logs, DFIR e incidentes          | 20               | Hipótesis correcta y trazabilidad de evidencia     |
| JSON y uso de herramientas       | 15               | Esquema válido y acción apropiada                  |
| Ingeniería inversa               | 10               | Interpretación técnica contrastable                |
| Explicaciones y falsos positivos | 10               | Calibración, referencias y ausencia de invenciones |
| TOTAL                            | 100              | Misma batería para cada modelo                     |

## Protocolo mínimo de medición

- Fijar el mismo runtime, plantilla de chat, temperatura y límites de tokens; documentar cualquier excepción por arquitectura.

- Medir tasa de aciertos, falsos positivos, cobertura, calidad de parches y corrección funcional de llamadas a herramientas.

- Registrar latencia del primer token, tokens/s, ocupación de memoria y variación con 8K, 16K y 32K de contexto.

- Repetir casos con y sin MTP/DFlash2 en los modelos compatibles; anotar cuándo la especulación no aporta mejora.

- Revisar manualmente discrepancias importantes, errores de hechos y referencias inexistentes antes de sacar conclusiones.

# 8. Arquitectura funcional recomendada para ARTIFEX

| **Rol propuesto**                | **Modelo**            | **Estado / siguiente acción**              |
|----------------------------------|-----------------------|--------------------------------------------|
| Motor técnico general            | Cyber-Tiel Q5 + MTP (rápido) o Q6 + MTP (calidad) | Activo: Q6 + MTP en 18081 para ARTIFEX; Q5 + MTP en los perfiles NEW |
| Investigador de vulnerabilidades | BugHunter v8 (rápido) o v7 + MTP | v8 ya instalado; validar calidad frente a v7 con casos reales |
| Defensa / multimodal             | OrcaCyber Nano        | Sin visión: MTP (73 % aceptación). Con visión: `mmproj` y sin MTP |
| Agente de herramientas           | Bimo CyberAgent       | Bajo demanda: 32K máximo y ~31 tok/s       |
| Revisor transversal              | Qwen Cyber Q6         | Perfil opcional para doble revisión        |
| Documentación y normativa        | BaronLLM v2           | Bajo demanda                               |
| Consultas ligeras                | BaronLLM Offensive 8B | Secundario                                 |
| Clasificador experimental        | Huihui 0.8B           | No habilitar tareas críticas sin validar   |
| BugHunter v8                     | Descargado y medido   | ~78–80 tok/s; sin MTP                      |
| Cyber-Tiel Q5                    | Descargado y medido   | 75–90 tok/s con MTP; 32,6 GiB a 256K       |

La recomendación no es tener todos los perfiles activos en memoria, sino enrutar cada solicitud al modelo apropiado, descargarlo de la RAM al finalizar si el servidor lo permite y evitar múltiples instancias pesadas sin una planificación de recursos.

# 9. Licencias, procedencia y puntos pendientes

Las fichas comunitarias pueden contener información incompleta, benchmarks no reproducidos o licencias declaradas que no sustituyen las del modelo base. En especial, revisar la licencia qwen de OrcaCyber y los términos originales de Llama 3.1 para BaronLLM. Antes de uso comercial, verificar dataset de ajuste, atribuciones y derechos sobre los pesos.

**Pendiente 1.** Comprobar hashes o rutas exactas de los archivos cacheados y el modelo base asociado a cada GGUF, para hacer el inventario reproducible.

**Pendiente 2.** Determinar con qué runtime y plantilla se sirven cada modelo y proyector, especialmente en ARM64/GB10.

**Pendiente 3.** Cuantificar velocidad, uso de memoria y calidad con la batería de pruebas real de ARTIFEX.

**Pendiente 4.** Confirmar licencias efectivas, condiciones de uso y procedencia de los datos antes de un despliegue comercial.

# 10. Conclusiones

La colección cubre adecuadamente cuatro necesidades diferentes: código y agentes técnicos (Cyber-Tiel), investigación de vulnerabilidades web/API (BugHunter v7), defensa y material visual (OrcaCyber Nano), y herramientas automatizadas ligeras (Bimo). El resto de modelos contribuye como segunda opinión, conocimiento temático o soporte experimental.

No priorizaría descargar más modelos antes de medir el rendimiento y la calidad de los presentes. El mayor retorno inmediato está en ampliar los perfiles de ARTIFEX a OrcaCyber y Bimo, poner límites operativos adecuados y ejecutar una evaluación de 100 casos para validar o corregir la clasificación.

> **DECISIÓN OPERATIVA (MEDIDA)**
> Núcleo: Cyber-Tiel con su drafter MTP (Q6 para ARTIFEX por calidad, Q5 donde importe la velocidad o la memoria) y BugHunter v8 como especialista web/API rápido, con v7 + MTP como referencia hasta comparar calidad. OrcaCyber Nano entra sin visión y con MTP; con capturas, en un perfil aparte con `mmproj`. Bimo, bajo demanda. Usar Qwen Cyber como revisor, reservar BaronLLM para documentación y relegar Huihui a experimentación.


# Fuentes y repositorios

Enlaces de referencia para modelos, especificaciones, archivos y afirmaciones de los publicadores. Los datos de tamaño/instalación proceden del inventario proporcionado; los resultados de evaluación son del desarrollador salvo que se indique lo contrario.

**\[F1\]** [Cyber-Tiel Coder 35B-A3B GGUF](https://huggingface.co/peculiar-ragdoll/Cyber-Tiel-Coder-35B-A3B-GGUF)

**\[F2\]** [BugHunter v7 · Qwen3.8 27B](https://huggingface.co/mmp2055/Qwen3.8-27B-Uncensored-bughunter-v7)

**\[F3\]** [OrcaCyber Nano 1.0](https://huggingface.co/orcarouter/OrcaCyber-Nano-1.0)

**\[F4\]** [Bimo 7B CyberAgent · modelo base](https://huggingface.co/iBimo-o/Bimo-7B-CyberAgent)

**\[F5\]** [Bimo 7B CyberAgent · distribución GGUF](https://huggingface.co/mradermacher/Bimo-7B-CyberAgent-GGUF)

**\[F6\]** [Qwen3.8 Uncensored Cyber GGUF](https://huggingface.co/philbert440/Qwen3.8-27B-Uncensored-Cyber-GGUF)

**\[F7\]** [BaronLLM v2 Qwen3 14B GGUF](https://huggingface.co/AlicanKiraz0/Qwen3-14B-BaronLLM-v2-Q4_0-GGUF)

**\[F8\]** [BaronLLM Offensive Security Llama GGUF](https://huggingface.co/AlicanKiraz0/Cybersecurity-BaronLLM_Offensive_Security_LLM_Q6_K_GGUF)

**\[F9\]** [Huihui Qwen3.5 0.8B Offensive Red Team](https://huggingface.co/azminawwar/huihui-ai_Huihui-Qwen3.5-0.8B-abliterated_Ultimate-Offensive-Red-Team)

AMPLIACIÓN DEL INFORME / PARTE II

# 11. Modelos generales, programación y otras especialidades

Evaluación de 17 modelos de chat adicionales descargados en el DGX Spark. Esta segunda parte complementa la evaluación previa de los ocho modelos de ciberseguridad y permite diseñar un catálogo operativo de 25 modelos conversacionales para ARTIFEX, OpenCode y RAGKit · Paramita.

Fecha de análisis: 21 de noviembre de 2026. Equipo: NVIDIA DGX Spark, GB10, 128 GB de memoria unificada. Las cifras de espacio se refieren a ficheros descargados, no a memoria residente ni a rendimiento medido en el equipo.

| **17**                      | **9**                         | **8**                  | **~1,16 TB**                |
|-----------------------------|-------------------------------|------------------------|-----------------------------|
| modelos de chat adicionales | con proyector de visión local | actualmente solo texto | ocupación nominal declarada |


## 11.1 Criterio de lectura y alcance

Las recomendaciones combinan fichas de los publicadores, objetivos de entrenamiento, características de arquitectura y el formato efectivamente descargado. Ninguna puntuación de ranking de esta adenda es un benchmark realizado en este Spark. Una variante “abliterated”, “uncensored”, “heretic” o “derestricted” modifica sobre todo el comportamiento de rechazo; no demuestra por sí misma más conocimientos, mejor programación ni más fiabilidad.

Se valoran seis dimensiones: adecuación de las tareas, calidad de evidencias, facilidad de ejecución en GB10, compatibilidad del motor de inferencia, riesgos de cuantización y utilidad para una arquitectura con varios modelos. Nueve entradas tienen mmproj descargado; ello habilita potencialmente imágenes si el runtime admite la arquitectura exacta. No implica que la visión funcione ya en ARTIFEX ni que el modelo acepte salida de imagen.

# 12. Inventario técnico de los 17 modelos

## 12.1 Modelos con entrada visual disponible (9)

| **Modelo**                               | **Cuantización**           | **Pesos / total** | **Archivos de apoyo**        |
|------------------------------------------|----------------------------|-------------------|------------------------------|
| DeepSeek V4.1 Flash GSQ-RCO Coder        | IQ2_XXS · seis shards      | 182,7 GB total\*  | Engram 110,6 GB · mmproj 1,0 |
| GLM-5.3 Flash · Unsloth                  | UD-IQ2_XXS · cuatro partes | 101,8 GB          | mmproj 1,1 GB                |
| GLM-5.3 Flash Uncensored · BoldingBuilds | IQ2_XXS · tres partes      | 97,1 GB           | mmproj 1,1 GB                |
| Qwen3.8 Flash Next · Unsloth             | UD-IQ3_XXS · cuatro partes | 83,6 GB           | MTP 2,8 · mmproj 0,9 GB      |
| Qwen3.8 Flash Next GSQ-RCO abliterated   | IQ3_XXS · dos partes       | 76,1 GB           | mmproj 0,9 GB                |
| Gemma 4 31B heretic · llmfan46           | Q6_K                       | 25,2 GB           | mmproj 1,2 GB                |
| Qwen3.8 27B original · Unsloth           | UD-Q6_K                    | 22,0 GB           | mmproj 0,9 GB · RAGKit       |
| Qwen3.8 27B abliterated · Blackfrost     | Q6_K                       | 22,4 GB           | mmproj 0,6 GB                |
| DeepSeek V4 Pro / Qwen3.5 9B heretic     | Q8_0                       | 9,8 GB            | mmproj 0,9 GB                |

\* Corrección de inventario: según ISTA-DASLab, 182,72 GB ya incluyen 72,12 GB de backbone y 110,60 GB de Engram. Si el inventario muestra otro archivo Engram de 110,6 GB, comprobar si es una copia física, un enlace o un recuento repetido; no se trata de otro modelo autónomo.

## 12.2 Modelos de texto (8)

| **Modelo**                       | **Cuantización**    | **Espacio**    | **Nota**                            |
|----------------------------------|---------------------|----------------|-------------------------------------|
| Assistant Pepe 70B               | Q6_K_L + Q4_K_M     | 60,6 + 44,0 GB | Dos cuantizaciones del mismo modelo |
| Qwen3-Coder-Next abliterated     | Q6_K_L · dos partes | 65,7 GB        | MoE 80B / ~3B activos               |
| Kimi-Dev 72B                     | Q6_K · dos partes   | 64,3 GB        | Denso; repositorios y parches       |
| GPT-OSS 120B Derestricted        | MXFP4_MOE           | 63,4 GB        | Razonamiento y herramientas         |
| Qwen3.8 40B Ultimate Heretic NEO | Q8_0                | 42,0 GB        | MTP integrado según inventario      |
| Kimi Linear 48B-A3B Instruct     | Q6_K_L              | 40,6 GB        | MoE, atención híbrida               |
| Dolphin Mistral 24B Venice       | Q8_0                | 25,1 GB        | Sin mmproj descargado               |
| Gemma 4 12B it heretic           | Q8_0                | 12,7 GB        | Sin mmproj descargado               |

Alcance: no se incluyen modelos de embedding, reranking, audio, transcripción ni generación de imágenes o vídeo. No debe compararse directamente el tamaño total de disco con los 128 GB de memoria unificada.

# 13. Fichas de evaluación y tareas recomendadas

## 13.1 DeepSeek V4.1 Flash GSQ-RCO Coder · ISTA-DASLab

Arquitectura: Base 763B; backbone original 551,9B; versión Coder conserva ~280,1B en el transformador \| Instalación: IQ2_XXS; backbone 72,12 GB + Engram 110,60 GB; mmproj ~1 GB

**Expertise principal.** Experimento de ingeniería de software de alto nivel con memoria externa en SSD.

**Tareas recomendadas.** Revisión de cambios extensos, propuestas de refactorización, solución de incidencias complejas, síntesis de documentos técnicos y comprobación multimodal puntual.

**Ventajas y evidencia.** La poda de expertos está calibrada para código y agentes. El autor comunica 77,0 en SWE-bench Verified y 88,57 en LiveCodeBench v6 para Coder, con reasoning effort 50; son resultados de su evaluación sobre esta compilación.

**Limitaciones.** La poda elimina la mitad de expertos enrutados y puede degradar tareas generales. Engram es un componente necesario; necesita enlace correcto entre shards y soporte moderno de llama.cpp (b11870 o superior) o Strata. El tráfico de tablas en SSD y la latencia real en GB10 no están medidos aquí.

*Valoración: PILOTO TÉCNICO; no backend por defecto. · Fuente: \[G01\]*

## 13.2 GLM-5.3 Flash original · Unsloth

Arquitectura: MoE 320B totales / 18B activos \| Instalación: UD-IQ2_XXS, 101,8 GB; mmproj 1,1 GB

**Expertise principal.** Razonamiento complejo, planificación agéntica e interpretación visual.

**Tareas recomendadas.** Planificación de proyectos, análisis multicriterio, generación de código, lectura de esquemas, problemas técnicos y orquestación de herramientas complejas.

**Ventajas y evidencia.** La familia base incorpora visión nativa, atención híbrida y razonamiento con niveles low/high/max. La ficha del proveedor describe rendimiento fuerte en benchmarks de agentes y programación.

**Limitaciones.** IQ2_XXS es una compresión extrema. Los resultados publicados para la versión oficial no miden esta cuantización. El peso deja un margen operativo estrecho en 128 GB, particularmente con contexto largo, imágenes y concurrencia.

*Valoración: PRUEBA AVANZADA, solo si supera al Qwen3.8 27B/Gemma 31B en tus tareas. · Fuente: \[G02\]*

## 13.3 GLM-5.3 Flash Uncensored · BoldingBuilds

Arquitectura: MoE 320B totales / 18B activos \| Instalación: IQ2_XXS, 97,1 GB; mmproj 1,1 GB

**Expertise principal.** Laboratorios de análisis no restringido y comparación contra el GLM original.

**Tareas recomendadas.** Consultas de investigación exploratoria, revisión de temas sensibles legítimos, contrastes de instrucciones y análisis visual supervisado.

**Ventajas y evidencia.** La versión IQ2_XXS fue reconstruida manteniendo ciertos tensores críticos en mayor precisión. El publicador documenta 24/24 en una prueba reducida de coherencia (razonamiento, código y retención).

**Limitaciones.** 24/24 son únicamente pruebas cortas del autor, no una validación general de seguridad ni coding. Abliteration reduce rechazos, no aumenta precisión. Comprobar que los shards pertenecen a la revisión corregida.

*Valoración: LABORATORIO; preferir el GLM original en usos generales verificables. · Fuente: \[G03\]*

## 13.4 Qwen3.8 Flash Next original · Unsloth

Arquitectura: Familia qwen4exp; ~177B totales, ~6B activos en el núcleo MoE; embeddings n-gram \| Instalación: UD-IQ3_XXS, 83,6 GB; MTP 2,8 y mmproj 0,9 GB

**Expertise principal.** Planificador/analista de contextos amplios y agente general experimental.

**Tareas recomendadas.** Descomponer tareas complejas, sintetizar información extensa, construir planes, revisar código con contexto amplio y comprender imágenes.

**Ventajas y evidencia.** Atención híbrida Gated DeltaNet + Qwen Sparse Attention, n-gram embeddings y contexto base de 262K; el fabricante anuncia extensiones hasta 1M bajo condiciones específicas.

**Limitaciones.** Arquitectura reciente y soporte de runtime sensible a versión. La mejora prometida para contextos largos no garantiza velocidad en GB10. IQ3_XXS puede alterar precisión; MTP requiere compatibilidad y medición de tasa de aceptación.

*Valoración: PILOTO comparativo de agentes; no sustituir al modelo RAG sin evaluación. · Fuente: \[G04\]*

## 13.5 Qwen3.8 Flash Next GSQ-RCO abliterated · SC117

Arquitectura: Misma familia de ~177B; modificación de rechazo sobre quant GSQ-RCO \| Instalación: IQ3_XXS, 76,1 GB; mmproj 0,9 GB

**Expertise principal.** Alternativa no restringida para análisis, creatividad técnica y pruebas de robustez.

**Tareas recomendadas.** Segunda opinión en problemas de razonamiento, prototipos de agentes flexibles y laboratorios donde un filtro de rechazo sería un obstáculo.

**Ventajas y evidencia.** El autor documenta trasplante localizado de 144 tensores, preservando el resto del trabajo de cuantización GSQ-RCO; ofrece trazabilidad del procedimiento.

**Limitaciones.** No hay un benchmark independiente de calidad que demuestre ventaja sobre la versión original. Reducir rechazos no equivale a mejorar razonamiento, seguridad o fidelidad. No exponer a usuarios sin una capa externa de permisos.

*Valoración: LABORATORIO; conservar solo si demuestra utilidad frente al original. · Fuente: \[G05\]*

## 13.6 Gemma 4 31B Instruct uncensored/heretic · llmfan46

Arquitectura: 31B, arquitectura densa \| Instalación: Q6_K, 25,2 GB; mmproj 1,2 GB

**Expertise principal.** Analista multimodal y razonador general de alta prioridad.

**Tareas recomendadas.** Interpretar documentos, gráficas y capturas; explicación científica; programación; revisión de procedimientos; comparación de informes; tutoría técnica.

**Ventajas y evidencia.** La familia Gemma 4 tiene visión nativa, contexto de hasta 256K en 31B y benchmarks oficiales competitivos. El derivado del autor utiliza Heretic/ARA y declara 10 rechazos en 100 frente a 99 en la base.

**Limitaciones.** Los benchmarks de Gemma 4 original no se pueden trasladar al Heretic Q6 sin repetirlos. La reducción de rechazos puede deteriorar ciertas respuestas. Comprobar salida JSON, citas y precisión en documentos.

*Valoración: PRIORIDAD ALTA para chat profundo y análisis con imágenes. · Fuente: \[G06\]*

## 13.7 Qwen3.8 27B original · Unsloth (RAGKit · Paramita)

Arquitectura: 27B densos; contexto nativo 262K \| Instalación: UD-Q6_K, 22,0 GB; mmproj 0,9 GB

**Expertise principal.** Modelo general principal y generador final de respuestas RAG.

**Tareas recomendadas.** Preguntas sobre documentación recuperada, respuestas con citas, extracción estructurada, resumen fiable, explicación técnica, ayuda de programación y lectura de diagramas.

**Ventajas y evidencia.** Base original no abliterada, cuantización de alta fidelidad y soporte multimodal. Ofrece un punto de control estable frente a los derivados con cambios de rechazo.

**Limitaciones.** Las citas requieren verificación externa: un LLM puede inventar referencias si el recuperador no impone fuentes. RAGKit debe pasar fragmentos identificados y limitar respuestas al contexto cuando proceda.

*Valoración: MANTENER como perfil RAG/productividad por defecto. · Fuente: \[G07\]*

## 13.8 Qwen3.8 27B ABLITERATED · Blackfrost-AI

Arquitectura: 27B densos; 64 capas de texto, 262K de contexto \| Instalación: Q6_K, 22,4 GB; mmproj 0,6 GB

**Expertise principal.** Segundo analista general con menor rechazo y soporte de visión.

**Tareas recomendadas.** Debate crítico, revisión de hipótesis, análisis de casos no convencionales, pruebas de guardarraíles y consultas técnicas legítimas que la base rechace indebidamente.

**Ventajas y evidencia.** Modificación limitada a supresión de rechazo; no es una especialización nueva. La ficha describe MTP integrado en las versiones recientes y proyectores de visión separados.

**Limitaciones.** No confundir obediencia con competencia. Hay versiones revisadas de los GGUF: comprobar el hash/fecha local y compatibilidad de la plantilla. Sin ventaja demostrada frente a la base para RAG o programación.

*Valoración: RESPALDO especializado; no reemplazar automáticamente el original. · Fuente: \[G08\]*

## 13.9 DeepSeek V4 Pro / Qwen3.5 9B uncensored-heretic

Arquitectura: 9B; base real Qwen3.5-9B, no pesos DeepSeek V4 Pro \| Instalación: Q8_0, 9,8 GB; mmproj 0,9 GB

**Expertise principal.** Asistente pequeño para STEM, scripts y consultas técnicas breves.

**Tareas recomendadas.** Explicar matemáticas, física y química, generar scripts cortos, tutoría de conceptos, extraer datos de capturas y realizar borradores estructurados.

**Ventajas y evidencia.** El ajuste original se declara destilado de respuestas DeepSeek V4 Pro y entrenado con ~250.000 ejemplos STEM; tamaño contenido y Q8 favorecen pruebas rápidas.

**Limitaciones.** El nombre comercial es engañoso si se interpreta como el modelo DeepSeek V4 real. Las ganancias en código/herramientas son preliminares y no hay evaluación suficiente del Heretic GGUF.

*Valoración: AUXILIAR ligero; no analista de referencia. · Fuente: \[G09\]*

## 13.10 Assistant Pepe 70B · bartowski

Arquitectura: 70B densos; derivado de Llama 3.1 \| Instalación: Q6_K_L 60,6 GB + Q4_K_M 44,0 GB

**Expertise principal.** Ideación lateral, comunicación creativa y conversación informal.

**Tareas recomendadas.** Brainstorming, estilos de escritura, guiones, nombres, contrargumentos creativos, propuestas originales y reformulación de textos.

**Ventajas y evidencia.** La ficha del autor enfatiza pensamiento lateral, diversidad de respuestas y estilo distintivo. La versión Q6 preserva más información de pesos que Q4.

**Limitaciones.** Personalidad deliberadamente provocadora y sesgo de negatividad: no apropiado como asistente corporativo sin revisión. Las afirmaciones de superioridad del autor no prueban excelencia global. Su licencia deriva de Llama.

*Valoración: CREATIVIDAD; guardar una sola cuantización si se necesita espacio. · Fuente: \[G10\]*

## 13.11 Qwen3-Coder-Next abliterated · bartowski/Huihui

Arquitectura: 80B totales / 3B activos, MoE; contexto 262K \| Instalación: Q6_K_L, 65,7 GB; dos shards

**Expertise principal.** Primera elección de la colección para desarrollo y agentes de código.

**Tareas recomendadas.** OpenCode, navegación de repositorios, generación de cambios con tests, refactorización multarchivo, migraciones, scripts, revisión de pull requests y uso supervisado de herramientas.

**Ventajas y evidencia.** El Qwen3-Coder-Next original está entrenado para agentes de programación, herramientas y recuperación de fallos; Q6_K_L de bartowski ofrece buena fidelidad cuantizada. Soporta numerosas tecnologías y modo no-thinking.

**Limitaciones.** La versión descargada está abliterada y no dispone de benchmark propio equivalente al original. Hay que respetar su plantilla/parser de tool calls, medir errores de edición y proteger terminal/credenciales.

*Valoración: TOP 1 para programación agéntica si supera las pruebas locales. · Fuente: \[G11\]*

## 13.12 Kimi-Dev 72B · Unsloth

Arquitectura: 72B densos; familia Qwen2.5 \| Instalación: Q6_K, 64,3 GB; dos shards

**Expertise principal.** Reparador de bugs y revisor de incidencias complejas.

**Tareas recomendadas.** Tomar issue + código + tests y proponer parche, depurar fallos de integración, analizar regresiones, escribir tests de reproducción y revisar pull requests.

**Ventajas y evidencia.** El equipo original comunica 60,4 % en SWE-bench Verified, tras optimización de resolución de incidencias mediante entrenamiento con recompensa de tests en Docker. Es evidencia específica de ingeniería de software.

**Limitaciones.** El 60,4 % no describe tu GGUF Q6 ni su comportamiento en GB10. Modelo denso de 72B: cada token implica más cómputo que en muchos MoE y no será necesariamente rápido.

*Valoración: ESPECIALISTA de bug fixing; comparar con Qwen3-Coder-Next. · Fuente: \[G12\]*

## 13.13 GPT-OSS 120B Derestricted · gghfez

Arquitectura: ~117B totales; MoE nativo GPT-OSS \| Instalación: MXFP4_MOE, 63,4 GB; solo texto

**Expertise principal.** Segundo razonador de alto nivel y contraste general.

**Tareas recomendadas.** Análisis de requisitos complejos, razonamiento con varias restricciones, revisión crítica de informes, programación asistida y descomposición de problemas extensos.

**Ventajas y evidencia.** Deriva de gpt-oss-120b y conserva su formato MXFP4 MoE, apto para dispositivos con memoria suficiente; es más pequeño en disco que varios 70B densos Q6.

**Limitaciones.** Derestricted modifica el comportamiento de rechazo, no garantiza equivalencia de razonamiento con la base. Debe respetarse el formato/plantilla de GPT-OSS; sin mmproj, no admite imágenes en la instalación. Verificar tooling en ARM64.

*Valoración: ALTERNATIVA de razonamiento; medir latencia y calidad antes de producción. · Fuente: \[G13\]*

## 13.14 Qwen3.8 40B Ultimate Heretic NEO · DavidAU

Arquitectura: ~39–40B declarados; expansión personalizada desde 27B \| Instalación: Q8_0, 42,0 GB; MTP integrado según inventario

**Expertise principal.** Modelo experimental de escritura y estilos de respuesta.

**Tareas recomendadas.** Narrativa larga, ideación, diálogos, ensayo de prompts, explicaciones creativas y comparación de enfoques de razonamiento.

**Ventajas y evidencia.** El publicador declara varios entrenamientos y modos de razonamiento/estilos; Q8 conserva mayor fidelidad que GGUF más comprimidos del mismo derivado.

**Limitaciones.** “50x” y “AGI” no constituyen métricas científicas. No hay comparación independiente reproducible con Qwen3.8-27B ni auditoría completa del corpus. La disponibilidad de visión en un repositorio no implica visión en tu instalación sin mmproj.

*Valoración: EXPERIMENTAL creativo; no tratar como sustituto validado de modelos oficiales. · Fuente: \[G14\]*

## 13.15 Kimi Linear 48B-A3B Instruct · bartowski

Arquitectura: 48B totales / ~3B activos; MoE, atención híbrida \| Instalación: Q6_K_L, 40,6 GB; solo texto

**Expertise principal.** Generalista eficiente para tareas prolongadas y documentos extensos.

**Tareas recomendadas.** Resumir documentación extensa, mantener conversaciones largas, consolidar especificaciones, extraer decisiones, razonamiento general y asistentes persistentes.

**Ventajas y evidencia.** La arquitectura Kimi Delta Attention busca reducir la memoria de contexto. Moonshot publica un límite arquitectónico de 1M tokens y estudios de eficiencia en contextos muy largos.

**Limitaciones.** 1M no es una configuración práctica que deba activarse sin probar memoria, velocidad y recuperación real de información. Backend y kernels tienen que admitir la arquitectura específica.

*Valoración: CANDIDATO para contexto largo; medir 32K, 64K y 128K primero. · Fuente: \[G15\]*

## 13.16 Dolphin Mistral 24B Venice Edition · bartowski

Arquitectura: ~24B densos; familia Mistral Small 3.x \| Instalación: Q8_0, 25,1 GB; sin mmproj descargado

**Expertise principal.** Chat expresivo, redacción y asistente permisivo de uso general.

**Tareas recomendadas.** Borradores, reformulación de textos, diálogo, traducción, ideas creativas, generación de mensajes y asistencia ligera en código.

**Ventajas y evidencia.** Tamaño moderado y cuantización Q8. El modelo Venice está orientado a respuestas poco restrictivas y conversaciones naturales.

**Limitaciones.** La variante actualizada 1.2 anuncia visión y mejora de herramientas, pero el GGUF de bartowski instalado podría proceder de una revisión anterior. Sin proyector local, tratarlo como texto. Comprobar revisión exacta antes de atribuirle novedades.

*Valoración: CHAT/REDACCIÓN; alternativa ligera y expresiva. · Fuente: \[G16\]*

## 13.17 Gemma 4 12B it heretic · igorls

Arquitectura: 12B densos \| Instalación: Q8_0, 12,7 GB según inventario; sin mmproj

**Expertise principal.** Asistente rápido para productividad, estudio y clasificación.

**Tareas recomendadas.** Resúmenes cortos, correos, tutoría, preguntas generales, clasificación de tickets, texto a JSON y scripts sencillos.

**Ventajas y evidencia.** Base Gemma 4 con razonamiento y tool calling; tamaño reducido. El autor describe un tratamiento específico de las negativas en modo thinking.

**Limitaciones.** Los resultados de abliteration no miden calidad general. Su ficha procede de un checkpoint QAT-Q4_0 y señala que Q4_0 preserva especialmente bien el entrenamiento de cuantización: Q8 no implica el mejor coste/beneficio. Comprobar que el Q8 de 12,7 GB coincide con la revisión indicada.

*Valoración: LIGERO diario; evaluar como alternativa al 9B. · Fuente: \[G17\]*

# 14. Matriz de selección según el trabajo

Las siguientes asignaciones constituyen una estrategia inicial de routing. “Principal” indica encaje funcional esperado, no superioridad ya demostrada en un mismo benchmark.

| **Especialidad / tarea**                         | **Opción principal**      | **Alternativa / contraste**    |
|--------------------------------------------------|---------------------------|--------------------------------|
| Programación con OpenCode y cambios multiarchivo | Qwen3-Coder-Next          | Kimi-Dev 72B / Cyber-Tiel      |
| Corrección de incidencias verificadas por tests  | Kimi-Dev 72B              | Qwen3-Coder-Next               |
| Revisión de código y seguridad preventiva        | Cyber-Tiel Q6             | Qwen3-Coder-Next               |
| Chat general y productividad                     | Qwen3.8 27B original      | Gemma 4 31B                    |
| RAG documental / RAGKit · Paramita               | Qwen3.8 27B original      | Gemma 4 31B                    |
| Documentos escaneados, gráficos, capturas        | Gemma 4 31B + mmproj      | Qwen3.8 27B + mmproj           |
| Planificación y proyectos de alta complejidad    | Gemma 4 31B               | GPT-OSS 120B / Qwen Flash Next |
| Documentación extensa / persistencia de contexto | Kimi Linear 48B           | Qwen3.8 Flash Next             |
| Análisis STEM y matemáticas ligero               | DeepSeek-Pro-Qwen 9B      | Gemma 4 12B                    |
| Análisis STEM de mayor profundidad               | Gemma 4 31B               | GPT-OSS 120B                   |
| Escritura creativa e ideación                    | Assistant Pepe 70B        | Dolphin Venice 24B             |
| Redacción neutra y reescritura profesional       | Qwen3.8 27B original      | Gemma 4 31B                    |
| Laboratorio no restringido                       | Qwen3.8 27B Blackfrost    | GLM uncensored / SC117         |
| Búsqueda de límites de cuantización y runtime    | GLM 5.3 / Qwen Flash Next | DeepSeek V4.1 GSQ-RCO Coder    |
| Chat rápido y clasificación de solicitudes       | Gemma 4 12B               | DeepSeek-Pro-Qwen 9B           |

# 15. Arquitectura de perfiles propuesta para el servidor


## 15.1 Cuándo elegir un modelo en vez de otro

Para contestar preguntas con fuentes recuperadas, el perfil RAG debe seleccionar Qwen3.8 27B original y exigir evidencia textual concreta. Para editar repositorios, OpenCode debería dirigirse primero a Qwen3-Coder-Next; si el objetivo principal es cerrar un bug con tests de aceptación, ejecutar en paralelo una comparación con Kimi-Dev. Si intervienen capturas o esquemas, usar Gemma 4 31B o Qwen3.8 27B con mmproj real y backend probado.

Para investigación exploratoria o temas donde una negativa automática entorpezca una actividad legítima, activar conscientemente un perfil abliterated y mantener los mismos controles externos de ejecución. No deben concederse acceso ilimitado a shell, secretos, redes o sistemas de producción solo por el nombre del modelo.

## 15.2 Servicio persistente frente a carga bajo demanda

| **Nivel**                      | **Modelos sugeridos**                                             | **Criterio**                                                   |
|--------------------------------|-------------------------------------------------------------------|----------------------------------------------------------------|
| Persistente / predeterminado   | Qwen3.8 27B original; Gemma 4 12B si necesitas un endpoint ligero | Baja presión de memoria, buen encaje para chat/RAG             |
| Bajo demanda para programación | Qwen3-Coder-Next; Kimi-Dev                                        | Cargar al recibir tarea de repositorio y descargar al terminar |
| Bajo demanda para visión       | Gemma 4 31B; OrcaCyber Nano                                       | Activar con mmproj y motor compatibles                         |
| Pilotos intensivos             | GLM 5.3, Qwen Flash Next, DeepSeek V4.1                           | Aislar pruebas y registrar consumo/tokens por segundo          |
| Creatividad / uso puntual      | Pepe, Dolphin, DavidAU                                            | Perfil separado de flujos empresariales verificables           |

# 16. Qué es viable en un único DGX Spark

Los 128 GB del GB10 son memoria unificada compartida entre CPU, GPU y sistema. El tamaño de los pesos en el SSD es distinto del pico residente: hay que añadir KV cache o estado de atención, buffers, memoria del runtime, proyector de visión y otros procesos. En modelos MoE, pocos parámetros activos reducen cómputo por token, pero no eliminan la necesidad de almacenar o acceder a los expertos totales.

| **Clase operativa**                 | **Ejemplos descargados**                                               | **Recomendación**                                                                                    |
|-------------------------------------|------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------|
| Cómoda: ~10–30 GB                   | Gemma 12B; Qwen3.8 27B; Gemma 31B; Dolphin 24B                         | Buenas opciones base, con 8–32K de contexto inicial                                                  |
| Media: ~40–66 GB                    | Kimi Linear; DavidAU 40B; GPT-OSS; Kimi-Dev; Qwen3-Coder-Next; Pepe Q6 | Ajustar contexto y concurrencia; benchmark de velocidad                                              |
| Pesada: ~76–84 GB                   | Qwen Flash Next original y SC117                                       | Viable en principio, pero cuantización/compatibilidad por verificar                                  |
| Muy ajustada: ~97–102 GB            | GLM 5.3 Flash original y uncensored                                    | Una carga principal a la vez; vigilar reserva para contexto                                          |
| Especial: 182,7 GB físicos en disco | DeepSeek V4.1 GSQ-RCO Coder                                            | Backbone ~72 GB + Engram 110,6 GB con memoria mapeada en SSD; no cargarlo como GGUF ordinario en RAM |

En todos los casos, comenzar con contexto 8K o 16K y crecer a 32K/64K únicamente cuando haga falta. Las cifras 256K y 1M son capacidades arquitectónicas declaradas; no equivalen a garantías de latencia, memoria o recuperación exacta de información.

# 17. Espacio en disco y duplicados: auditoría antes de borrar

## 17.1 DeepSeek V4.1: Engram no es un modelo alternativo

La ficha de ISTA-DASLab es explícita: la edición Coder contiene ~72,12 GB de backbone y necesita la tabla Engram compartida de ~110,60 GB como sexto shard; los 182,72 GB son la suma de ambos. Engram no es una versión de chat de 110,6 GB utilizable por sí sola. La tabla se consulta selectivamente y puede permanecer en un SSD rápido. Es imprescindible mantenerla accesible y enlazarla con el nombre de shard que espera el motor.

El inventario nominal de esta conversación contabiliza 182,7 GB para Coder y otros 110,6 GB como “versión Engram”; por eso su total anunciado se aproxima a 1,16 TB. Es posible que se haya contado el mismo contenido dos veces (o que existan descargas físicamente duplicadas). No se puede deducir un ahorro de 110,6 GB sin revisar la identidad real de blobs, enlaces y hashes en la caché.

## 17.2 Assistant Pepe: duplicación de cuantizaciones

Aquí sí constan dos cuantizaciones del mismo modelo: Q6_K_L de ~60,6 GB y Q4_K_M de ~44,0 GB. Si usas siempre Q6, Q4 suele ser prescindible y podría liberar hasta ~44 GB de datos únicos; si privilegias latencia y espacio, conserva Q4 y considera prescindible Q6 (~60,6 GB). El ahorro exacto depende de deduplicación por contenido en Hugging Face.

## 17.3 Cálculo nominal y precauciones

| **Concepto**                                                                                    | **Espacio aproximado** |
|-------------------------------------------------------------------------------------------------|------------------------|
| Suma de los 17 registros y auxiliares, contando Engram 110,6 GB dos veces como en el inventario | 1.161,1 GB             |
| Suma si Engram ya está incluido en los 182,7 GB de Coder y no existe segunda copia física       | 1.050,5 GB             |
| Dos variantes locales de Assistant Pepe, tomadas conjuntamente                                  | 104,6 GB               |
| Espacio potencial al descartar una variante de Pepe (si son blobs independientes)               | 44,0 o 60,6 GB         |

Los cálculos son a partir de tamaños redondeados aportados y no sustituyen “du” de los blobs reales. No borres archivos sueltos dentro de snapshots/cache ni el shard Engram utilizado por DeepSeek. Verifica primero modelo dependiente, enlaces simbólicos, referencias y hashes; realiza limpieza mediante las utilidades de Hugging Face que correspondan a tu versión, y repite inventario tras la operación.

# 18. Evidencia disponible: no confundir benchmark con marketing

| **Modelo/familia**          | **Qué se ha publicado**                                                 | **Límite de interpretación**                                                    |
|-----------------------------|-------------------------------------------------------------------------|---------------------------------------------------------------------------------|
| Qwen3-Coder-Next original   | Arquitectura y entrenamiento explícitos de coding agéntico              | Sin resultado equivalente verificado para abliterated Q6                        |
| Kimi-Dev 72B original       | 60,4 % SWE-bench Verified según el equipo original                      | No medido en el GGUF Q6 instalado                                               |
| DeepSeek V4.1 GSQ-RCO Coder | 77,0 SWE-bench Verified; 88,57 LiveCodeBench v6, evaluación del creador | Experimento comprimido, especialización en código; no implica velocidad en GB10 |
| GLM 5.3 original            | Benchmarks de codificación/agentes del proveedor                        | No transferibles automáticamente al IQ2_XXS                                     |
| GLM 5.3 uncensored IQ2      | 24/24 pruebas de coherencia del autor tras reconstrucción               | Batería reducida; no mide rendimiento profesional amplio                        |
| Gemma 4 original            | Benchmarks de razonamiento, código y visión en ficha de Google          | No equivalen al resultado de los GGUF Heretic                                   |
| Assistant Pepe 70B          | Reclamaciones de UGI y ejemplos de pensamiento lateral                  | Evitar extrapolar a precisión general / ingeniería                              |
| DavidAU 40B NEO             | Muchos modos y afirmaciones “50x/AGI” del autor                         | No hay prueba independiente reproducible de esas mejoras                        |
| Blackfrost / SC117 / gghfez | Documentación de abliteration y conversión/quant                        | Menos rechazos no significa más aciertos ni seguridad                           |

# 19. Plan de adopción y evaluación en ARTIFEX / OpenCode / RAGKit

## 19.1 Secuencia aconsejada

**Primera etapa.** Mantener Qwen3.8 27B original como referencia para RAG, y Gemma 4 31B como segundo analista multimodal. Probar ambos con preguntas que exijan citas a fragmentos recuperados.

**Segunda etapa.** Habilitar Qwen3-Coder-Next Q6 en OpenCode bajo permisos limitados, con pruebas de edición/reparación. Compararlo con Kimi-Dev Q6 y Cyber-Tiel Q6 sobre el mismo conjunto de incidencias.

**Tercera etapa.** Medir Kimi Linear para tareas de contexto de 32K, 64K y 128K; medir GPT-OSS como revisor independiente. Probar si la calidad del resultado compensa memoria y latencia.

**Cuarta etapa.** Tratar GLM, Qwen Flash Next y DeepSeek V4.1 como pilotos con métricas de tiempo al primer token, tokens/s, memoria, tasa de error y capacidad de atender solicitudes simultáneas.

**Quinta etapa.** Seleccionar una sola variante de Assistant Pepe tras decidir si aporta valor creativo. Verificar la duplicación real de Engram sin borrar componentes necesarios.

## 19.2 Batería homogénea para 17 modelos

| **Bloque**                       | **Casos** | **Métrica principal**                                 |
|----------------------------------|-----------|-------------------------------------------------------|
| Reparación de software y pruebas | 25        | Tests pasados + diffs correctos                       |
| RAG y recuperación factual       | 20        | Exactitud de citas y tasa de alucinación              |
| Razonamiento multietapa/STEM     | 15        | Exactitud verificable                                 |
| Herramientas / JSON / agentes    | 15        | Invocaciones correctas, sin acciones fuera de alcance |
| Visión de capturas/documentos    | 10        | Extracción correcta y errores de lectura              |
| Contexto largo y coherencia      | 10        | Aciertos sobre hechos dispersos en documentos         |
| Redacción/creatividad            | 5         | Evaluación ciega de utilidad y estilo                 |

Las pruebas deberán repetirse con temperatura, presupuesto de tokens, configuración de reasoning y plantilla compatibles con cada familia; no todas usan el mismo modo de razonamiento. Registrar por separado exactitud, latencia, tokens/s de generación, consumo máximo de memoria y errores del runtime. El tamaño del archivo y la cifra de tokens/s publicada para otra GPU no sustituyen una medición del GB10.

# 20. Recomendación final y referencias de la segunda parte


Fuentes originales de modelos y cuantizaciones consultadas. Las descripciones de capacidades y resultados publicados se atribuyen a sus autores; las recomendaciones operativas son una valoración del informe. Las fichas del proveedor pueden actualizarse y deben cotejarse con el hash del modelo instalado.

**\[G01\]** [ISTA-DASLab · DeepSeek V4.1 GSQ-RCO Coder](https://huggingface.co/ISTA-DASLab/DeepSeek-V4.1-Flash-1017-GSQ-RCO-Coder-GGUF)

**\[G02\]** [Unsloth · GLM-5.3 Flash GGUF](https://huggingface.co/unsloth/GLM-5.3-Flash-GGUF)

**\[G03\]** [BoldingBuilds · GLM-5.3 Flash Uncensored](https://huggingface.co/BoldingBuilds/orcarouter_GLM-5.3-Flash-Uncensored-GGUF)

**\[G04\]** [Unsloth · Qwen3.8 Flash Next GGUF](https://huggingface.co/unsloth/Qwen3.8-Flash-Next-GGUF)

**\[G05\]** [SC117 · Qwen3.8 Flash Next GSQ-RCO abliterated](https://huggingface.co/SC117/Qwen3.8-Flash-Next-GSQ-RCO-abliterated-GGUF)

**\[G06\]** [llmfan46 · Gemma 4 31B Heretic GGUF](https://huggingface.co/llmfan46/gemma-4-31B-it-uncensored-heretic-GGUF)

**\[G07\]** [Unsloth · Qwen3.8 27B GGUF](https://huggingface.co/unsloth/Qwen3.8-27B-GGUF)

**\[G08\]** [Blackfrost-AI · Qwen3.8 27B Abliterated GGUF](https://huggingface.co/Blackfrost-AI/Qwen3.8-27B-ABLITERATED-GGUF)

**\[G09\]** [mradermacher · DeepSeek-V4-Pro / Qwen3.5 9B Heretic](https://huggingface.co/mradermacher/DeepSeek-V4-Pro-Qwen3.5-9B-UNCENSORED-heretic-GGUF)

**\[G10\]** [bartowski · Assistant Pepe 70B GGUF](https://huggingface.co/bartowski/SicariusSicariiStuff_Assistant_Pepe_70B-GGUF)

**\[G11\]** [bartowski · Huihui Qwen3-Coder-Next Abliterated GGUF](https://huggingface.co/bartowski/huihui-ai_Qwen3-Coder-Next-abliterated-GGUF)

**\[G12\]** [Moonshot / Unsloth · Kimi-Dev 72B](https://huggingface.co/unsloth/Kimi-Dev-72B)

**\[G13\]** [gghfez · GPT-OSS 120B Derestricted GGUF](https://huggingface.co/gghfez/gpt-oss-120b-Derestricted.MXFP4_MOE-gguf)

**\[G14\]** [DavidAU · Qwen3.8 40B Ultimate Heretic NEO](https://huggingface.co/DavidAU/Qwen3.8-40B-Ultimate-Heretic-Uncensored-Turbo-Brilliance-50x-AGI-NEO-GGUF)

**\[G15\]** [bartowski · Kimi Linear 48B-A3B GGUF](https://huggingface.co/bartowski/moonshotai_Kimi-Linear-48B-A3B-Instruct-GGUF)

**\[G16\]** [bartowski · Dolphin Mistral 24B Venice GGUF](https://huggingface.co/bartowski/cognitivecomputations_Dolphin-Mistral-24B-Venice-Edition-GGUF)

**\[G17\]** [igorls · Gemma 4 12B Heretic GGUF](https://huggingface.co/igorls/gemma-4-12B-it-qat-q4_0-unquantized-heretic-GGUF)

**\[B01\]** [Qwen · Qwen3-Coder-Next original](https://huggingface.co/Qwen/Qwen3-Coder-Next)

**\[B02\]** [Google · Gemma 4 original](https://huggingface.co/google/gemma-4-31B-it)

**\[B03\]** [Moonshot · Kimi Linear original](https://huggingface.co/moonshotai/Kimi-Linear-48B-A3B-Instruct)

**\[B04\]** [Z.ai · GLM-5.3 Flash original](https://huggingface.co/zai-org/GLM-5.3-Flash)

**\[B05\]** [Moonshot · Kimi-Dev 72B original](https://huggingface.co/moonshotai/Kimi-Dev-72B)

**\[B06\]** [Dolphin Venice original](https://huggingface.co/dphn/Dolphin-Mistral-24B-Venice-Edition)

PARTE III / AMPLIACIÓN OPERATIVA / 21 NOV 2026

# 21. Modelos pendientes y perfiles optimizados para 128 GB

Esta sección complementa el inventario de 25 modelos de chat ya descargados. Evalúa dos ficheros ausentes de ARTIFEX (BugHunter v8 y Cyber-Tiel Q5), propone un modelo generalista ligero y cuantizaciones alternativas, y diseña configuraciones simultáneas para ciberseguridad, desarrollo avanzado y cargas mixtas.

**Criterio de decisión.** Los 128 GB de memoria unificada del GB10 son compartidos por Linux, GPU, cachés KV, buffers del motor de inferencia y otros servicios. Todas las cifras siguientes son tamaños publicados de ficheros en GB decimales; no son mediciones reales de memoria del DGX.

Estado actualizado: BugHunter v8, Cyber-Tiel Q5 (con drafter MTP) y Qwen3-Coder-Next Q4_K_M ya están descargados y medidos. Siguen pendientes Qwen3.5-9B original y Qwen3.5-35B-A3B original. Las secciones 24 a 26 incluyen la memoria real medida.

# 22. Dos modelos que faltan en ARTIFEX

## 22.1 BugHunter v8: Qwen3.5-35B-A3B Uncensored (MoE)

| **Dimensión**        | **Dato publicado / evaluación**                                                                     |
|----------------------|-----------------------------------------------------------------------------------------------------|
| **Situación**        | DESCARGADO y medido en el GB10: ~78–80 tok/s, 22,8 GiB a 128K con KV q8_0.                          |
| **Arquitectura**     | Qwen3.5-35B-A3B; aproximadamente 35B totales y 3B activos por token (MoE).                          |
| **Fichero LLM**      | Qwen3.5-35B-A3B-uncensored-bughunter-v8.Q4_K_M.gguf — 21,2 GB según árbol de ficheros.              |
| **Visión opcional**  | mmproj-BF16.gguf — 0,903 GB. El ajuste de entrenamiento utilizó solo texto.                         |
| **Contexto**         | 262.144 admitidos según autor; iniciar el servicio con 16K y probar 32K antes de ampliar.           |
| **Punto importante** | GGUF sin cabeza MTP (`nextn_predict_layers=0`). MyDGX y ARTIFEX no la activan; no hay nada que desactivar. El drafter de Cyber-Tiel no sirve para v8. |

Qué aporta frente a BugHunter v7. El autor reutiliza el corpus y los hiperparámetros de v7, pero adapta una base Mixture of Experts mucho menos costosa por token activo que una red densa de 27B. Mantiene el objetivo principal: bug bounty, seguridad web/API, pruebas en alcance autorizado y elaboración de informes. La comunicación está orientada al español con terminología y artefactos técnicos en inglés.

**Ventajas.** Buena especialización funcional; GGUF de unos 21 GB que permite coexistir con varios analistas; entrada visual opcional; posibilidad de usarlo con el orquestador Bughunter Harness descrito por el autor, que anuncia controles de alcance y ritmo de solicitudes.

**Velocidad medida en el GB10.** v8 escribe a ~78–80 tok/s, unas 6 veces más que v7 (~13 tok/s) y unas 2,5 veces más que v7 con su MTP integrado (~31 tok/s). Los ~30 frente a ~7 tok/s del desarrollador eran de Apple Silicon y se quedan cortos en el Spark.

**Inconvenientes.** La equivalencia de calidad del 90 % procede de pruebas del desarrollador, no de una evaluación independiente. Documenta errores concretos de concepto en HTTP request smuggling CL.TE y alucinaciones de CVE, herramientas y direcciones. El ajuste solo tocó determinados bloques; las capacidades de visión no se especializaron en seguridad.

**Integración (comprobada).** llama.cpp `v1.0.0` reconoce qwen35moe. Funciona con Flash Attention, un slot y KV q8_0 a 128K, con lotes 2048/512 (22,8 GiB). La recomendación del autor de no cuantizar el KV sigue sin contrastar en calidad: si aparecen respuestas degradadas en contextos largos, probar KV F16 antes que otra cuantización del modelo. Configurar verificación humana y herramientas limitadas por alcance.

Valor operativo: DESCARGADO; especialista rápido por defecto. No retirar v7 hasta superar un benchmark de 20-30 casos reales y demostrar menor latencia, calidad igual o mayor y uso correcto de herramientas. Fuentes: \[A01\] y \[A02\].

## 22.2 Cyber-Tiel Q5: 35B-A3B UD-Q5_K_XL

| **Opción**                    | **Tamaño** | **Diferencia frente a Q6** | **Estado** |
|-------------------------------|------------|----------------------------|------------|
| **Q6_K_XL**                   | 31,8 GB    | Referencia actual          | DESCARGADO |
| **Q5_K_XL**                   | 26,6 GB    | Ahorra 5,2 GB              | DESCARGADO |
| **Drafter `mtp-*.gguf` (Q5 y Q6)** | 1,48 GB | —                       | DESCARGADO |
| **Q5_K_S**                    | 24,9 GB    | Ahorra 6,9 GB              | No necesario |
| **Q4_K_XL**                   | 22,4 GB    | Ahorra 9,4 GB              | No necesario |
| **Q5_K_XL con MTP integrado** | 27,0 GB    | Ahorra 4,8 GB              | Innecesario: el drafter aparte hace lo mismo |

**Medido en el GB10 (KV q8_0, lotes 2048/512):**

| **Variante** | **Memoria a 256K** | **Escritura** |
|---|---|---|
| Q6 + drafter | 37,4 GiB | ~61 tok/s sin MTP; 58–74 tok/s con MTP |
| Q5 + drafter | 32,6 GiB (30,2 GiB a 128K) | 63–64 tok/s sin MTP; 70–92 tok/s con MTP |

Los lotes 2048/512 suben la lectura del prompt de ~1550 a ~2060 tok/s frente a 512/256, sin cambiar la escritura.

No es un modelo distinto de Cyber-Tiel Q6, sino otra cuantización del mismo derivado de Ornith-1.5. Conserva la orientación hacia programación, automatización y seguridad, con una imatrix calibrada usando corpus técnicos. El autor presenta Q5_K_XL como el punto de equilibrio de 32 GB y Q4_K_XL como la elección más cómoda de 4 bits.

**Cuándo descargar Q5.** Cuando necesites compartir RAM con BugHunter v8, Qwen3-Coder-Next o OrcaCyber sin reducir el contexto de todos. La pérdida exacta frente a Q6 en tu trabajo todavía está por medir: no asumir que la cuantización menor es idéntica en auditorías difíciles.

**Ajuste MTP (medido).** El drafter separado del repositorio de Cyber-Tiel (`--spec-type draft-mtp --spec-draft-model mtp-….gguf`) acelera Q5 y Q6 sin descargar la edición con MTP integrado. No usar el drafter y el `mmproj` a la vez: llama.cpp no combina especulativa y visión.

Valor operativo: Q5 + MTP es la opción por defecto para velocidad y perfiles con varios modelos. Q6 + MTP queda para ARTIFEX y como referencia de calidad hasta medir la diferencia en auditorías difíciles. Fuentes: \[A03\] y \[A04\].

# 23. Qué añadiría para cubrir cyber, coding y propósito general

No conviene llenar otros cientos de gigabytes sin una mejora concreta. Las ausencias más útiles son una versión de Cyber-Tiel con mejor densidad de memoria, el nuevo especialista BugHunter y un generalista pequeño y no abliterated que pueda permanecer activo mientras los modelos grandes se descargan de RAM.

| **Candidato**                           | **Prioridad**   | **Peso nuevo aproximado** | **Qué resuelve**                                                                          |
|-----------------------------------------|-----------------|---------------------------|-------------------------------------------------------------------------------------------|
| **BugHunter v8 Q4_K_M**                 | Hecho           | 21,2 GB                   | Bug bounty / seguridad web y API con un MoE ligero. ~78–80 tok/s medidos.                 |
| **Qwen3.5-9B original Q6_K**            | 1 - Alta        | 7,46 GB (+0,92 GB visión) | Asistente general rápido, clasificación, triage y respuestas sin especialización Heretic. Mientras tanto, el 9B Heretic con MTP da 30–49 tok/s. |
| **Cyber-Tiel Q5_K_XL + drafter MTP**    | Hecho           | 26,6 + 1,48 GB            | Mismo perfil cyber/coding que Q6, más rápido y con 4,8 GiB menos.                         |
| **Qwen3-Coder-Next abliterated Q4_K_M** | Hecho           | 48,56 GB                  | Alternativa compacta al Q6 instalado. ~50 tok/s medidos; sin MTP.                         |
| **Qwen3.5-35B-A3B original Q5_K_L**     | 5 - Opcional    | 26,23 GB                  | Control generalista MoE original; útil solo si gana en pruebas al Qwen3.8 27B actual.     |

## 23.1 Qwen3.5-9B original Q6_K: mi única incorporación generalista prioritaria

El GGUF de Unsloth ofrece Q6_K de 7,46 GB y mmproj-BF16 de aproximadamente 0,92 GB. Es el post-training original de Qwen3.5-9B, no una variante “uncensored” ni un supuesto DeepSeek. Sus funciones naturales son resumir mensajes y documentación, extraer campos, clasificar incidencias, responder consultas corrientes, apoyar RAG y analizar imágenes cuando el proyector está cargado.

**Por qué añade valor.** Actualmente el menor generalista razonablemente completo de tu inventario es una variante Heretic de 9B en Q8. Un baseline original a Q6, unos 2,3 GB más ligero, es una comparación útil para fidelidad factual, uso de herramientas y tareas de baja latencia. No reemplaza a Qwen3.8 27B original como revisor complejo.

Licencia indicada por Qwen/Unsloth: Apache-2.0. Medir la velocidad real; el menor tamaño no demuestra por sí solo una latencia inferior. Fuentes: \[A05\] y \[A06\].

## 23.2 Qwen3-Coder-Next Q4_K_M: variante de eficiencia, no un nuevo experto

Tu Q6_K_L de 65,7 GB es una buena referencia de programación avanzada. El GGUF de bartowski del mismo modelo abliterated tiene Q4_K_M de 48,56 GB y Q5_K_M de 56,85 GB. Q4 libera aproximadamente 17,1 GB frente al Q6 y abre combinaciones con BugHunter v8, OrcaCyber o Cyber-Tiel. En tareas de programación compleja podría degradar detalles, por lo que hay que conservar Q6 como opción de máxima fidelidad.

Si la prioridad es robustez comercial, merece además comparar con el Qwen3-Coder-Next original; su Q4_K_M ocupa aproximadamente 48,7 GB. Una abliteración no equivale a un entrenamiento adicional de programación. Fuentes: \[A07\], \[A08\].

## 23.3 Qué NO añadiría de momento

No añadiría otro 70B generalista, más modelos Heretic redundantes ni un antiguo modelo de seguridad sin evidencia superior a tu colección. RAGKit ya dispone de Qwen3.8 27B original y Gemma 4 31B para visión; Qwen3.5-35B-A3B original queda como control opcional, no residente.

# 24. Política de memoria en un solo DGX Spark

Para determinar si un modelo “cabe” hay que sumar pesos, proyector visual, KV, buffers y carga de Linux. El tamaño del GGUF en SSD no equivale a su consumo residente. Un MoE activa menos expertos por token, pero el conjunto de pesos sigue necesitando memoria u offloading.

| **Indicador**                 | **Objetivo práctico inicial**               | **Observación**                                                                  |
|-------------------------------|---------------------------------------------|----------------------------------------------------------------------------------|
| **Suma de pesos simultáneos** | Preferentemente \<=90 GB                    | Es una regla conservadora de planificación, no un límite impuesto por NVIDIA.    |
| **Margen nominal**            | Idealmente \>=35-40 GB                      | Antes de descontar OS, asignaciones del runtime y KV; más margen da estabilidad. |
| **Contexto / slots**          | 128K y 1 slot por modelo en perfiles múltiples; 256K solo en solitario | Con KV q8_0, pasar Tiel Q5 de 128K a 256K cuesta 2,4 GiB. |
| **Visión**                    | Cargar mmproj solo en endpoints que la usen | Cada modelo tiene su propio proyector compatible. Excluye MTP en ese endpoint.   |
| **Speculative decoding**      | Activar MTP donde el GGUF o el drafter lo permitan | Medido: Tiel Q5/Q6, v7, OrcaCyber y 9B aceleran o igualan. v8 y Coder-Next no tienen MTP. |
| **KV cache**                  | q8_0 en todos los perfiles medidos          | Funciona en qwen35moe. KV F16 en v8 queda como prueba de calidad pendiente.      |
| **Lotes**                     | 2048/512 en los modelos MoE                 | Lectura del prompt un ~33 % más rápida; la memoria ya está incluida en las cifras medidas. |

Nota sobre unidades: se suman tamaños de GGUF en GB decimales publicados por Hugging Face y el inventario. La memoria que muestra free -h se expresa generalmente en GiB, con reservas y uso de Linux; “128 - pesos” es solo margen contable nominal. Las combinaciones de las secciones 25.1 a 25.4 son las del informe original y no se han cargado; la sección 25.0 recoge las que sí se han medido.

# 25. Configuraciones operativas recomendadas

Las tablas dan estimaciones para pesos y, cuando se indica, proyectores concretos. El “resto nominal” se calcula frente a 128 GB: no incluye Linux, cachés, otras cargas ni reservas. Se debe validar cada servicio en tu firmware, kernel, driver y versión de llama.cpp.

## 25.0 PERFILES MEDIDOS EN EL DGX SPARK (prevalecen sobre 25.1–25.4)

Creados en MyDGX como «NEW - …». Cargados a la vez sobre RAGKit · Paramita, con 128K de contexto, KV q8_0 y un slot por modelo. La memoria es el incremento real sobre RAGKit; la velocidad es de escritura con el perfil completo cargado.

| **Perfil** | **Modelos** | **Memoria sobre RAGKit** | **Escritura** |
|---|---|---|---|
| **NEW - Cybersecurity** | Cyber-Tiel Q5 + MTP · BugHunter v8 · OrcaCyber + MTP (sin visión) | 70,7 GiB | 63 · 55 · 23 tok/s (aceptación MTP 72 % y 73 %) |
| **NEW - Cybersecurity · Coding** | Cyber-Tiel Q5 + MTP · BugHunter v8 · 9B Heretic + MTP | 58,1 GiB | 62 · 60 · 30 tok/s |
| **NEW - Advanced Coding** | Qwen3-Coder-Next Q4_K_M · 9B Heretic + MTP | 60,4 GiB | 51 · 34 tok/s |
| **NEW - Coding · Cyber** | Qwen3-Coder-Next Q4_K_M · BugHunter v8 | 68,9 GiB | 50 · 60 tok/s |

Equivalencias con el informe original: NEW - Cybersecurity sustituye a CY-E (Bimo queda bajo demanda); NEW - Cybersecurity · Coding sustituye a MIX-L; NEW - Advanced Coding es DEV-E sin Cyber-Tiel; NEW - Coding · Cyber es MIX-E sin OrcaCyber.

**DEV-E y MIX-E no caben con RAGKit cargado.** Con los datos medidos, DEV-E necesitaría unos 90 GiB sobre RAGKit (Advanced Coding 60,4 + Tiel Q5 30,2) y MIX-E unos 87 GiB (Coding · Cyber 68,9 + OrcaCyber ~18). Solo son viables parando RAGKit.

Un perfil se arranca cuando el anterior ha liberado la memoria: en las pruebas, arrancar 10 s después de parar ARTIFEX falló; esperando 40 s, funcionó.

## 25.1 SOLO CIBERSEGURIDAD

| **Perfil**                           | **Modelos simultáneos**                                                                            | **Pesos + extras** | **Resto nominal** |
|--------------------------------------|----------------------------------------------------------------------------------------------------|--------------------|-------------------|
| **CY-L / ligero**                    | Cyber-Tiel Q5 (26,6) + BugHunter v8 (21,2)                                                         | 47,8 GB            | 80,2 GB           |
| **CY-E / equilibrado • sustituido por NEW - Cybersecurity** | Cyber-Tiel Q5 (26,6) + BugHunter v8 (21,2) + OrcaCyber (15,7) + Bimo (8,1) + 2 mmproj (1,8)        | 73,4 GB            | 54,6 GB           |
| **CY-Q / calidad de referencia**     | Cyber-Tiel Q6 actual (31,8) + BugHunter v8 (21,2) + OrcaCyber (15,7) + Bimo (8,1) + 2 mmproj (1,8) | 78,6 GB            | 49,4 GB           |

**CY-L.** Dos analistas complementarios: revisión técnica/programación y bug bounty. El más fácil de mantener con bajo consumo y sin servicios defensivos adicionales. Requiere las dos descargas pendientes.

**CY-E.** Cubre código y CTF (Tiel), seguridad web y APIs (BugHunter), DFIR/visión (OrcaCyber) y un ejecutor ligero supervisado (Bimo). Es mi elección si el servidor se dedica exclusivamente a ciberseguridad durante horas.

**CY-Q.** Igual cobertura, pero aprovecha el Q6 que ya tienes. Descarga únicamente BugHunter v8. La diferencia de calidad de Tiel Q6 frente a Q5 deberá medirse: este escenario puede evitar una descarga redundante.

Los 2 mmproj del escenario CY-E/CY-Q se refieren a BugHunter v8 (~0,9 GB) y OrcaCyber (~0,9 GB). El proyector opcional de Cyber-Tiel añadiría otros ~0,9 GB y no figura en los totales.

## 25.2 SOLO PROGRAMACIÓN AVANZADA

| **Perfil**                            | **Modelos simultáneos**                                                       | **Pesos** | **Resto nominal** |
|---------------------------------------|-------------------------------------------------------------------------------|-----------|-------------------|
| **DEV-L / ágil**                      | Cyber-Tiel Q5 (26,6) + Qwen3.5-9B Q6 (7,46)                                   | 34,1 GB   | 93,9 GB           |
| **DEV-E / equilibrado • no cabe con RAGKit (ver 25.0)** | Qwen3-Coder-Next Q4_K_M (48,56) + Cyber-Tiel Q5 (26,6) + Qwen3.5-9B Q6 (7,46) | 82,6 GB   | 45,4 GB           |
| **DEV-Q / alta fidelidad**            | Qwen3-Coder-Next Q6 actual (65,7) + Cyber-Tiel Q5 (26,6)                      | 92,3 GB   | 35,7 GB           |

**DEV-L.** Para proyectos pequeños, revisión de diffs, corrección de pruebas y desarrollo con muchos ciclos. Cyber-Tiel realiza programación y el Qwen9 controla preguntas de propósito general, documentación y clasificación.

**DEV-E.** El agente principal es Qwen3-Coder-Next Q4; Cyber-Tiel Q5 valida parches, propone alternativas y examina seguridad de cambios; el Qwen9 sirve como asistente persistente y filtro de tareas. Tres modelos que dejan margen razonable.

**DEV-Q.** Máxima prioridad a Qwen3-Coder-Next Q6 instalado, con Cyber-Tiel Q5 como revisor técnico. Adecuado solo tras verificar el margen real con contextos moderados y sin otros modelos grandes residentes. Alternativa de depuración: cambiar QwenCoder por Kimi-Dev 72B Q6 (64,3 GB), nunca cargar ambos 65,7+64,3 GB simultáneamente.

DEV-L y DEV-E omiten el mmproj opcional de Qwen3.5-9B (~0,92 GB): si se activa para visión, sumarlo. Para programación, no tratar a un modelo “uncensored” como más preciso por definición.

## 25.3 COMBINADO CIBERSEGURIDAD + PROGRAMACIÓN

| **Perfil**                            | **Modelos simultáneos**                                                               | **Pesos + extras** | **Resto nominal** |
|---------------------------------------|---------------------------------------------------------------------------------------|--------------------|-------------------|
| **MIX-L / bajo consumo**              | Cyber-Tiel Q5 (26,6) + BugHunter v8 (21,2) + Qwen3.5-9B Q6 (7,46)                     | 55,3 GB            | 72,7 GB           |
| **MIX-E / equilibrado • no cabe con RAGKit (ver 25.0)** | Qwen3-Coder-Next Q4 (48,56) + BugHunter v8 (21,2) + OrcaCyber (15,7) + 2 mmproj (1,8) | 87,3 GB            | 40,7 GB           |
| **MIX-Q / máxima programación**       | Qwen3-Coder-Next Q6 actual (65,7) + BugHunter v8 (21,2)                               | 86,9 GB            | 41,1 GB           |

**MIX-L.** Muy buena combinación si el propósito es auditar el código que se está programando: Tiel programa y revisa; BugHunter investiga seguridad web/API; Qwen9 clasifica, resume y sirve consultas generales.

**MIX-E.** Tres modelos con papeles claros: QwenCoder para implementar cambios, BugHunter para buscar fallos de aplicaciones y OrcaCyber para análisis defensivo y capturas. La mezcla tiene mayor cobertura, sin pasar de 90 GB nominales de ficheros cargados. Bimo y Qwen9 se activarían bajo demanda.

**MIX-Q.** Conserva el mejor peso de QwenCoder instalado y añade el nuevo BugHunter. No pretende abarcar DFIR y RAG simultáneamente; esos servicios se cargan cuando se necesitan, descargando previamente otro modelo grande.

Para un laboratorio con herramientas activas, adoptar el principio un endpoint principal + uno o dos revisores, y descargar el resto al finalizar cada fase. Añadir cada proyector solo si el flujo de trabajo realmente necesita imágenes.

## 25.4 Combinaciones funcionales SIN DESCARGAR NADA

| **Perfil** | **Modelos ya descargados**                                                           | **Total nominal** | **Uso**                                    |
|------------|--------------------------------------------------------------------------------------|-------------------|--------------------------------------------|
| **Cyber**  | Cyber-Tiel Q6 31,8 + BugHunter v7 16,8 + OrcaCyber 15,7 + Bimo 8,1 + mmproj Orca 0,9 | 73,3 GB           | Código, web, DFIR y herramientas.          |
| **Coding** | Qwen3-Coder-Next Q6 65,7 + Bimo 8,1 + Gemma 4 12B 12,7                               | 86,5 GB           | Agente fuerte + tool caller + generalista. |
| **Mixto**  | Cyber-Tiel Q6 31,8 + BugHunter v7 16,8 + Qwen3.8 27B original 22,0                   | 70,6 GB           | Auditoría de código, bug bounty y RAG.     |

Estas tres combinaciones no exigen nuevas descargas. Sirven como línea base para medir si los modelos pendientes justifican el gasto en SSD, la RAM y la complejidad operativa. El perfil mixto ya instalado es especialmente útil para comparar posteriormente BugHunter v7 frente a v8 con el mismo resto del sistema.

# 26. Qué combinaciones descartaría

| **Combinación**                                                    | **Motivo técnico**                                                                                                 |
|--------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------|
| **Qwen3-Coder-Next Q6 (65,7) + Kimi-Dev Q6 (64,3)**                | 130,0 GB de ficheros: supera 128 GB incluso antes del sistema y de la caché KV.                                    |
| **Qwen3-Coder-Next Q4 + Cyber-Tiel Q5 + BugHunter v8 + OrcaCyber** | 112,1 GB sin proyectores: demasiado poco margen para cuatro servicios, contextos y sistema.                        |
| **GLM-5.3 Flash IQ2_XXS (101,8) + BugHunter v8 (21,2)**            | 123,0 GB nominales; no equivale a un despliegue concurrente viable.                                                |
| **DeepSeek V4.1 GSQ-RCO Coder (182,7)**                            | No cabe como pesos residentes completos en 128 GB. Depende de una implementación especial y almacenamiento Engram. |
| **Tiel Q5 y Tiel Q6 simultáneos**                                  | Mismo entrenamiento; duplicar pesos en RAM sin crear una segunda especialidad distinta.                            |
| **BugHunter v7 y v8 simultáneos como configuración fija**          | Útiles para comparar, pero gasto persistente redundante si v8 demuestra calidad suficiente.                        |

La clave no es emplear toda la memoria disponible, sino conservar margen para el KV, el sistema, el reintento de procesos y la concurrencia real. Dos modelos grandes con un límite de contexto sensato suelen prestar mejor servicio que cuatro modelos pesados con CPU swap o latencia elevada.

# 27. Routing y papeles de los servicios

| **Entrada / servicio**                        | **Destino recomendado**                      | **Verificación necesaria**                                               |
|-----------------------------------------------|----------------------------------------------|--------------------------------------------------------------------------|
| **ARTIFEX: código y CTF de laboratorio**      | Cyber-Tiel Q5/Q6                             | Ejecutar tests; comparar con repositorio y estado real.                  |
| **ARTIFEX: bug bounty web/API**               | BugHunter v8, o v7 mientras no esté validado | Confirmar el alcance y reproducibilidad; revisar CL.TE y datos externos. |
| **SOC / incidentes / imágenes**               | OrcaCyber Nano: con MTP para texto; con mmproj (sin MTP) para capturas | Validar artefactos de origen y extraer evidencia trazable.               |
| **OpenCode: cambios complejos**               | Qwen3-Coder-Next Q4 o Q6                     | Tests automáticos, git diff y revisión humana antes de fusionar.         |
| **OpenCode: segundo revisor**                 | Cyber-Tiel Q5                                | Contrastar diseño y seguridad sin ejecutar cambios autónomos.            |
| **RAGKit / Paramita: respuestas con fuentes** | Qwen3.8 27B original                         | Citas recuperadas y comprobación de alucinaciones.                       |
| **Clasificación y consultas frecuentes**      | Qwen3.5-9B original Q6                       | Medir latencia, extracción a JSON y tasa de errores.                     |
| **Tool calling ligero**                       | Bimo CyberAgent Q8                           | Permisos mínimos, esquemas JSON validados y lista de funciones.          |

**Política de carga y verificación.** Mantener el asistente pequeño cuando sea útil; cargar un modelo grande al comenzar su tarea y liberarlo después. Verificar hallazgos con pruebas reproducibles o fuentes reales: otro LLM no sustituye la evidencia. Limitar las herramientas a repositorios y activos autorizados.

# 28. Plan de instalación, benchmark y aceptación

## 28.1 Descargas ordenadas por retorno esperado

| **Fase** | **Qué añadir**                           | **Espacio incremental aproximado** | **Criterio de avance**                                                            |
|----------|------------------------------------------|------------------------------------|-----------------------------------------------------------------------------------|
| **1**    | BugHunter v8 Q4                          | 21,2 GB                            | **Hecho.** Falta la comparación de calidad con v7 en 20 casos.                    |
| **2**    | Qwen3.5-9B original Q6 + mmproj opcional | 7,46 / 8,38 GB                     | Pendiente. Mejora la calidad/latencia del asistente ligero respecto a tus 9B/12B. |
| **3**    | Cyber-Tiel Q5_K_XL + drafter MTP         | 28,1 GB                            | **Hecho.** Más rápido que Q6 y 4,8 GiB menos; falta medir la precisión.          |
| **4**    | Qwen3-Coder-Next Q4_K_M                  | 48,56 GB                           | **Hecho.** Usado en los perfiles NEW de programación.                             |

Queda pendiente el Qwen3.5-9B original: solo conviene mantenerlo si supera al 9B Heretic con MTP o a Gemma 4 12B en tus tareas.

## 28.2 Batería de aceptación en el propio GB10

| **Bloque de pruebas**                           | **Casos** | **Qué medir**                                                                                |
|-------------------------------------------------|-----------|----------------------------------------------------------------------------------------------|
| **Bughunter v7 vs v8**                          | 20        | Verdaderos positivos, falsos positivos, calidad del informe, errores de concepto y latencia. |
| **Cyber-Tiel Q6 vs Q5 vs Q4 opcional**          | 20        | Tests de programación, auditoría, token/s, memoria máxima y comportamiento de herramientas.  |
| **QwenCoder Q6 vs Q4 opcional**                 | 20        | Parches correctos, regresiones, tiempo de ejecución y autonomía real del agente.             |
| **Qwen3.5 9B original vs 9B Heretic/12B Gemma** | 15        | Exactitud factual, JSON válido, clasificación, visión y rapidez.                             |
| **Concurrencia de perfiles CY / DEV / MIX**     | 15        | MemAvailable, uso de CPU/GPU, latencia p95, OOM y swaps.                                     |
| **Seguridad y reproducibilidad**                | 10        | Bloqueo de acciones fuera de alcance, control de secretos y registros de auditoría.          |

Total: 100 casos propuestos. No se trata de resultados obtenidos: registrar commit/hash de cada GGUF, versión de llama.cpp, plantilla, semilla/temperatura, contexto, batch, concurrencia, límites de salida y estado térmico. Publicar porcentajes únicamente después de ejecutar la prueba.

## 28.3 Comprobaciones de memoria y seguridad del servicio

Ejecutar antes de lanzar cada perfil y durante una sesión representativa, para detectar si el perfil realmente se puede sostener:

free -h  
grep -E "MemAvailable\|SwapFree" /proc/meminfo  
nvidia-smi  
ps -eo pid,rss,cmd --sort=-rss \| head -15

Estas órdenes no modifican el servidor. Los dos primeros indicadores distinguen memoria todavía disponible de memoria solo libre. Repetir la lectura durante la carga, en el primer prompt, con un contexto largo y tras varias solicitudes. Al exponer endpoints OpenAI-compatibles, usar bind a 127.0.0.1 o un proxy autenticado; no abrir puertos de inferencia sin controles de acceso.

# 29. Recomendación final de ampliación

**Recomendación medida.** Con RAGKit siempre activo, usar los cuatro perfiles de la sección 25.0. Para ciberseguridad, NEW - Cybersecurity (70,7 GiB). Para mezclar ciberseguridad y programación con margen, NEW - Cybersecurity · Coding (58,1 GiB). Para programación con un agente fuerte, NEW - Advanced Coding (60,4 GiB), o NEW - Coding · Cyber (68,9 GiB) si también hace falta revisión de seguridad web. DEV-E y MIX-E solo funcionan sin RAGKit.

**ARTIFEX.** Mantener Cyber-Tiel Q6 + MTP en 18081 como motor de calidad y BugHunter v8 como especialista rápido; pasar a Q5 + MTP si hace falta memoria o velocidad. BugHunter v7 + MTP queda como referencia hasta terminar la comparación v7/v8.

**Pendiente de medir:** calidad (la batería de 100 casos), v7 con 32K de contexto frente a los 256K usados, KV F16 en v8 y DFlash2 de OrcaCyber.

**La decisión importante.** Prioriza un modelo de código, un especialista en seguridad y, si el flujo lo exige, un generalista pequeño o analista defensivo. La especialización útil se obtiene con tareas reales, herramientas verificadas y rutas claras de activación, no con cinco variantes uncensored redundantes.

# Fuentes nuevas y ficheros recomendados

Enlaces directos a fichas y archivos verificados para la ampliación. Las cifras de velocidad y benchmarks proceden de sus respectivos autores salvo que se indique otra cosa.

**\[A01\]** [mmp2055 · BugHunter v8 (ficha, problemas conocidos y descarga)](https://huggingface.co/mmp2055/Qwen3.5-35B-A3B-uncensored-bughunter-v8)

**\[A02\]** [mmp2055 · BugHunter v8 (árbol de ficheros y tamaños)](https://huggingface.co/mmp2055/Qwen3.5-35B-A3B-uncensored-bughunter-v8/tree/main)

**\[A03\]** [peculiar-ragdoll · Cyber-Tiel GGUF, Q4/Q5/Q6, mmproj](https://huggingface.co/peculiar-ragdoll/Cyber-Tiel-Coder-35B-A3B-GGUF)

**\[A04\]** [peculiar-ragdoll · Cyber-Tiel con MTP integrado](https://huggingface.co/peculiar-ragdoll/Cyber-Tiel-Coder-35B-A3B-GGUF-MTP)

**\[A05\]** [Unsloth · Qwen3.5-9B GGUF (Q6 y proyector)](https://huggingface.co/unsloth/Qwen3.5-9B-GGUF/tree/main)

**\[A06\]** [Qwen · Qwen3.5-9B original (licencia y arquitectura)](https://huggingface.co/Qwen/Qwen3.5-9B)

**\[A07\]** [bartowski · Qwen3-Coder-Next abliterated, cuantizaciones](https://huggingface.co/bartowski/huihui-ai_Qwen3-Coder-Next-abliterated-GGUF)

**\[A08\]** [bartowski · Qwen3-Coder-Next original, cuantizaciones](https://huggingface.co/bartowski/Qwen_Qwen3-Coder-Next-GGUF)

**\[A09\]** [bartowski · Qwen3.5-35B-A3B original, cuantizaciones](https://huggingface.co/bartowski/Qwen_Qwen3.5-35B-A3B-GGUF)

**\[A10\]** [Qwen · Qwen3-Coder-Next, ficha de arquitectura y contexto](https://huggingface.co/Qwen/Qwen3-Coder-Next)
