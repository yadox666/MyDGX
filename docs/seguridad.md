# Seguridad

Modelo de seguridad de MyDGX: qué protege, cómo y qué debe configurar quien lo
administra.

## Exposición de red

- El dashboard (`8088`), el gateway (`4000`) y los runtimes de perfil escuchan
  solo en `127.0.0.1` por defecto.
- El acceso remoto recomendado es un **túnel SSH** (lo abre la app de barra de
  menús o `ssh -L`). Alternativa: un proxy HTTPS con autenticación.
- Si `HOST` es una dirección de red, MyDGX exige `MYDGX_DASHBOARD_PASSWORD` o
  `MYDGX_API_KEY`. Si `GATEWAY_HOST` escucha en red, exige `GATEWAY_API_KEY`.
  Sin protección, el dashboard responde `503` y el gateway no arranca.

## Autenticación

| Superficie | Mecanismo |
|---|---|
| Interfaz del dashboard | Si `MYDGX_DASHBOARD_PASSWORD` está definida, login con cookie firmada `HttpOnly`, `SameSite=Strict` y caducidad absoluta de 60 minutos. |
| API del dashboard | La cookie web anterior o la cabecera `X-MyDGX-Key: YOUR_API_KEY` para scripts cuando `MYDGX_API_KEY` está definida. |
| Gateway | `Authorization: Bearer YOUR_GATEWAY_API_KEY` o `x-api-key` para clientes que no estén en loopback. |
| Herramientas de Open WebUI | Clave propia `OPENWEBUI_TOOL_API_KEY`, generada por el despliegue. |

Las claves y contraseñas se comparan en tiempo constante (`hmac.compare_digest`).
El login limita los intentos fallidos por cliente. Los secretos se definen en el
`.env` del DGX, nunca en el código.

## Protección frente a otras webs (CSRF y DNS rebinding)

Aunque la API escuche solo en loopback, una página abierta en el navegador del
mismo equipo o del túnel podría intentar llamarla. Dashboard y gateway aplican:

1. **Validación de `Host`.** Solo se aceptan loopback, la dirección de escucha (o
   las IP y el nombre del equipo si escucha en todas) y `TRUSTED_HOSTS`. Un
   dominio externo que resuelva a `127.0.0.1` (DNS rebinding) recibe `403`.
2. **Validación de origen** en `POST`, `PUT`, `PATCH` y `DELETE`. Se rechaza un
   `Origin` que no sea el propio o uno permitido (`GATEWAY_CORS_ORIGINS`, y el
   servidor de desarrollo de Vite), y cualquier `Sec-Fetch-Site: cross-site`.
   Los clientes que no son navegadores (curl, SDK, Open WebUI) no envían
   `Origin` y no se ven afectados.

Cada rechazo queda en los logs como `http.cross_site_blocked`.

## Confirmaciones y operaciones privilegiadas

- Borrar modelos o perfiles exige escribir el nombre exacto.
- Parar servicios, motores o el modo memoria exige un texto de confirmación
  (`stop comfyui`, `liberar memoria`...).
- Actualizar o reparar el sistema exige `ENABLE_SYSTEM_UPDATES=true` y
  `ACTUALIZAR MYDGX` o `REPARAR MYDGX`. Controlar servicios exige
  `ENABLE_SERVICE_CONTROL=true`. Ambas opciones están desactivadas por defecto.
- `/etc/sudoers.d/mydgx` concede solo una lista cerrada: las órdenes APT de
  actualización, el script de reparación, `systemctl` sobre los servicios de
  MyDGX y el apagado. **Nunca** `NOPASSWD: ALL`. El navegador no puede enviar
  comandos arbitrarios.
- El asistente solo **propone** acciones. Se ejecutan cuando el usuario las
  confirma y caducan a los `ASSISTANT_ACTION_TTL_SECONDS`.
- Toda acción queda en la auditoría (`GET /api/audit`).

## Apps de perfil

Una app solo se ejecuta si cumple todas estas condiciones:

- es un subdirectorio directo de `PROFILE_APPS_ROOT` y no es un enlace
  simbólico;
- pertenece al usuario de MyDGX y su `start.sh` no es escribible por grupo ni
  por otros;
- figura en la lista `PROFILE_APPS`, si esta se ha definido.

Se lanza con un entorno mínimo, sin `HF_TOKEN` ni claves de MyDGX, y su salida va
a `logs/apps/`. Si se cancela o supera el tiempo máximo, se detiene su grupo de
procesos completo.

## Secretos y logs

- `HF_TOKEN` y las claves solo existen en el `.env` del servidor. No se devuelven
  al navegador (la API solo indica si están configurados), no se guardan en
  SQLite y no se escriben en logs.
- Los logs redactan cabeceras de autorización, cookies, tokens y campos
  sensibles antes de persistir. Ejemplo: `Authorization: Bearer ***REDACTED***`.
- El despliegue **no copia** `.env`, `.env.*`, `*.env`, `*.pem`, `*.key`, `.git`
  ni `.cursor` al DGX. Solo se copian las plantillas `*.env.example`.

## Despliegue y cadena de suministro

- **Clave SSH del DGX.** La primera conexión muestra la huella y pide
  confirmación (`--interactive`). La huella se guarda en `~/.MyDGX/known_hosts`
  (`MYDGX_KNOWN_HOSTS`). En modo no interactivo, una clave desconocida o
  cambiada aborta el despliegue, salvo que coincida con
  `MYDGX_SSH_HOST_FINGERPRINT=SHA256:...`. `MYDGX_SSH_ACCEPT_NEW=1` acepta claves
  nuevas, nunca cambiadas, y es solo para equipos efímeros. El
  chequeo de salud solo sustituye una clave cambiada si coincide con la huella
  esperada.
- **Instaladores verificados.** Ollama se comprueba por SHA-256 y versión fija.
  Node.js llega del repositorio APT firmado de NodeSource, con la huella de su
  clave verificada. hashcat se comprueba por SHA-256. El instalador nativo de
  Claude Code exige `MYDGX_CLAUDE_INSTALLER_SHA256`.
- **Versiones fijadas.** Open WebUI por versión, SearXNG por digest de imagen,
  ComfyUI por commit y llama.cpp b10679 por commit verificado.

## Servicios multimodales

- Whisper limita el tamaño de subida (`Content-Length` y cuerpos *chunked*).
- El worker de TTS se reinicia automáticamente si muere. Los errores devuelven
  el final de su log, sin datos de la petición.
- Las voces de referencia personales no se suben al DGX.

## Recomendaciones

- Mantén dashboard y gateway en localhost y usa el túnel SSH.
- Define `MYDGX_DASHBOARD_PASSWORD`, `MYDGX_API_KEY` y `GATEWAY_API_KEY` con
  valores distintos y aleatorios, directamente en el `.env` del DGX.
- Activa `ENABLE_SYSTEM_UPDATES` y `ENABLE_SERVICE_CONTROL` solo si los vas a
  usar.
- No confirmes en Git `.env`, bases de datos, cachés de modelos ni claves
  privadas.
