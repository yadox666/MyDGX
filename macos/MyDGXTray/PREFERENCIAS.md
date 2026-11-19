# Preferencias de MyDGX Tray

La ventana **Preferencias** administra uno o varios perfiles de conexión. Cada
perfil representa un equipo MyDGX y conserva por separado la API, SSH, túneles y
despliegue. La configuración se guarda con permisos `0600` en
`~/.MyDGX/config`; las claves API se guardan como archivos `0600` en
`~/.MyDGX/credentials` y no aparecen en `config`.

## Gestión de perfiles

La columna izquierda ofrece estas acciones:

- **+**: crea un perfil con valores iniciales.
- **Duplicar**: copia el perfil seleccionado, pero crea identificadores nuevos
  para el perfil y su archivo de credencial.
- **−**: elimina el perfil seleccionado. Debe permanecer al menos uno.
- **Asistente de instalación Spark** (botón azul, sobre *Buscar DGX en red*): abre
  el asistente (buscar, conectar, instalar y listo) para añadir otro Spark.
- **Aplicación › Buscar actualizaciones**: consulta las Releases de GitHub. Si hay
  una versión nueva, **Descargar e instalar** la verifica (SHA-256 y firma), deja
  la versión anterior en la Papelera y reinicia la app.
- **Aplicación › Idioma**: *Idioma del sistema* (por defecto) sigue el orden de
  idiomas de macOS: español si va antes que el inglés y, para cualquier otro
  idioma, inglés. *Español* o *English* fijan el idioma solo para MyDGXTray; es el
  mismo ajuste que Ajustes del Sistema › General › Idioma y región › Aplicaciones.
  El cambio se aplica al reiniciar la app (**Reiniciar ahora**); el túnel SSH y la
  configuración se conservan. Los mensajes que llegan del Spark (nombres de
  trabajos, errores del servidor) siguen en el idioma del dashboard.
  Tras añadir o cambiar textos, `scripts/localizations.py` regenera `es.lproj`
  y avisa de las claves sin traducir en `en.lproj`.
- **Usar este equipo**: convierte el perfil en el equipo activo. La telemetría,
  enlaces, perfiles de inferencia y acciones remotas usarán este equipo.

Eliminar un perfil no borra datos ni servicios del equipo remoto ni elimina
automáticamente su archivo de credencial. Tampoco debe usarse el mismo alias en
dos perfiles.

## Perfil

### Alias

Nombre visible del equipo, por ejemplo `Spark oficina` o `AxForge pruebas`.
Debe tener entre 2 y 60 caracteres. Admite letras, números, espacios, puntos,
guiones y guiones bajos.

### Tipo

Clasifica la conexión como **Local**, **Red local**, **AxForge** o **Remoto**.
Actualmente es una etiqueta organizativa: no cambia automáticamente los puertos
ni el método de conexión. Configura los demás campos según el acceso real.

## API MyDGX

### Protocolo

- **HTTP**: apropiado para `127.0.0.1` y para un túnel SSH.
- **HTTPS**: recomendado cuando la API se publica en una red. Si usa una CA
  privada, selecciona también su certificado en **Certificado CA**.

### Host

Hostname o IP de la API MyDGX, sin protocolo ni ruta, por ejemplo
`192.168.1.50`, `spark.local` o `mydgx.example.net`.

Cuando **Usar túnel** está activado, el Tray se conecta realmente a
`127.0.0.1` y este campo no determina el destino del túnel. El destino remoto de
la API es `127.0.0.1` en la configuración interna.

### Puerto

Puerto en el que escucha MyDGX. El valor predeterminado es `8088`. Debe estar
entre 1 y 65535.

Con túnel activo, el Tray usa **Puerto API local** en lugar de este puerto para
sus peticiones. **Puerto API remoto** debe coincidir con el puerto real de
MyDGX en el servidor.

### Ruta del dashboard

Ruta web que se añade a la URL base al pulsar **Abrir dashboard**. Normalmente
es `/`. Debe comenzar por `/` si se utiliza una subruta, por ejemplo `/mydgx/`.

### URL de Open WebUI

URL completa que abre el botón de Open WebUI, por ejemplo
`https://chat.example.net` o `http://127.0.0.1:13000`.

Puede dejarse vacía. En ese caso el Tray calcula:

- sin túnel: `http://HOST_API:3000`;
- con túnel: `http://127.0.0.1:PUERTO_OPENWEBUI_LOCAL`.

Si se escribe una URL explícita, debe incluir `http://` o `https://`.

### Actualizar cada N s

Intervalo de consulta de telemetría. Admite entre 1 y 3600 segundos; `5` es un
buen valor general. Un intervalo muy bajo aumenta las peticiones a la API.

## Autenticación y certificados

### Clave API

Valor de `MYDGX_API_KEY` configurado en el servidor. Al guardar, se almacena en
`~/.MyDGX/credentials` con permisos `0600`. El campo se vacía después de
guardarlo; dejarlo vacío conserva la clave existente.

La clave es necesaria cuando MyDGX escucha fuera de localhost. Con un túnel SSH
y MyDGX ligado a `127.0.0.1` puede omitirse, salvo que el servidor exija
autenticación también en localhost.

### Identificador de credencial

Identificador del archivo de credencial asociado al perfil. Se genera
automáticamente y normalmente no debe modificarse. Cambiarlo hace que el perfil
busque la clave API en otro archivo; no mueve ni copia la clave anterior.

### Certificado CA

Ruta local a un certificado CA en formato aceptado por macOS para validar un
servidor HTTPS privado. Déjalo vacío para HTTP o certificados emitidos por una
CA pública reconocida.

Una ubicación recomendada es:

```text
~/.MyDGX/certificates/mi-ca.pem
```

No selecciones aquí una clave privada de servidor.

## SSH

### Host SSH

Hostname o IP que usa SSH. Puede ser distinto del host de la API, especialmente
cuando la API solo escucha en localhost. Ejemplos: `spark.local`,
`192.168.1.50` o la IP pública asignada por AxForge.

### Usuario

Usuario Linux remoto creado en el equipo. Solo admite letras, números, puntos,
guiones y guiones bajos.

### Puerto

Puerto SSH remoto, normalmente `22`. En un alquiler puede ser un puerto
asignado, por ejemplo `22081`.

### Clave privada

Ruta local a la clave SSH privada del perfil. Debe ser legible únicamente por el
usuario (`chmod 600`) y corresponder a una clave pública instalada en
`~/.ssh/authorized_keys` del usuario remoto.

La ubicación recomendada es:

```text
~/.MyDGX/keys/<identificador>
```

El repositorio, las copias de seguridad y el despliegue no copian esta clave.
No introduzcas contraseñas en este campo.

## Túnel SSH administrado

Activa **Usar túnel** cuando MyDGX, Open WebUI, ComfyUI y el gateway de modelos
solo escuchan en el servidor remoto o no deben exponerse a la red. El Tray crea
las redirecciones SSH y mantiene la conexión con comprobaciones periódicas.

### Puerto API local

Puerto libre en el Mac al que se conectará el Tray. Predeterminado: `18088`.
La URL efectiva será `PROTOCOLO://127.0.0.1:18088`. Normalmente debe seleccionarse
HTTP porque el servicio remoto predeterminado también usa HTTP.

### Puerto API remoto

Puerto de MyDGX visto desde el servidor SSH. Predeterminado: `8088`.

### Puerto Open WebUI local

Puerto libre en el Mac para abrir Open WebUI. Predeterminado: `13000`.

### Puerto Open WebUI remoto

Puerto de Open WebUI visto desde el servidor SSH. Predeterminado: `3000`.

### Puerto ComfyUI local

Puerto libre en el Mac para abrir la interfaz de imagen y vídeo de ComfyUI.
Predeterminado: `18188`.

### Puerto ComfyUI remoto

Puerto de ComfyUI visto desde el servidor SSH. Predeterminado: `8188`.

### Puerto Gateway local

Puerto libre en el Mac para Claude Code, OpenCode, Codex y otros clientes de
modelos. Predeterminado: `14000`. Usa `http://127.0.0.1:14000/v1` para OpenAI
y `http://127.0.0.1:14000` para Anthropic.

### Puerto Gateway remoto

Puerto del gateway MyDGX visto desde el servidor SSH. Predeterminado: `4000`.

Los cinco puertos locales deben estar libres y ser distintos entre sí. Si varios
perfiles pueden conectarse simultáneamente, asigna puertos locales diferentes.
Los destinos remotos son `127.0.0.1`; no es necesario publicar MyDGX ni Open
WebUI en interfaces externas.

## Despliegue

### Proyecto local

Déjalo vacío para desplegar la versión de MyDGX incluida en la aplicación
descargada de Releases: se copia a `~/.MyDGX/source` y se despliega desde ahí.

Rellénalo solo si quieres desplegar tu propia copia del repositorio, por ejemplo
mientras desarrollas. Debe ser la raíz del repositorio y contener `start.sh`.
Usa **Elegir…** para evitar errores de ruta.

### Directorio remoto

Ruta relativa al directorio inicial del usuario SSH, por ejemplo
`MyDGX-Dashboard` o `apps/MyDGX-Dashboard`. No admite rutas absolutas ni `..`.

**Guardar y desplegar** sincroniza el proyecto con `rsync --delete`, excluyendo
`.env`, bases de datos, logs, dependencias compiladas, claves y otros secretos.
Después ejecuta el instalador del Tray y reinicia los servicios. No reemplaza el
aprovisionamiento completo descrito en el README principal.

## Copia de seguridad y controles

- **Copia de Seguridad DGX** guarda una instantánea de la base MyDGX y los datos
  de Open WebUI en `~/.MyDGX/backups/<alias>/<fecha>/`. No incluye modelos,
  cachés, `.env` ni claves.
- **Actualizar** solicita telemetría inmediatamente; no guarda los cambios del
  formulario.
- **Guardar** valida y persiste todos los perfiles. Si la clave API está vacía,
  conserva el archivo de credencial actual.

## Configuraciones habituales

### Equipo local

- Tipo: **Local**
- Protocolo: **HTTP**
- Host: `127.0.0.1`
- Puerto: `8088`
- Túnel: desactivado

### DGX en la red local mediante túnel

- Tipo: **Red local**
- Host SSH: hostname o IP del DGX
- Usuario y clave privada: credenciales SSH del usuario
- Túnel: activado
- API local/remota: `18088` / `8088`
- Open WebUI local/remoto: `13000` / `3000`
- ComfyUI local/remoto: `18188` / `8188`
- Gateway local/remoto: `14000` / `4000`
- Clave API: opcional si MyDGX solo escucha en `127.0.0.1`

### AxForge u otro servidor con puerto SSH asignado

- Tipo: **AxForge** o **Remoto**
- IP o hostname de red local: dirección usada cuando el Mac está dentro de la red
- IP o hostname público: dirección pública o DNS usado fuera de la red
- Puerto público/NAT: puerto externo redirigido al SSH del Spark; por ejemplo `65022`
- Usuario y clave privada: los de la instancia
- Túnel: activado
- Puertos remotos: los puertos reales de MyDGX, Open WebUI y Gateway
- Proyecto local: vacío para usar la versión incluida en la aplicación
- Directorio remoto: necesario para desplegar

### API publicada mediante HTTPS

- Protocolo: **HTTPS**
- Host: nombre DNS del certificado
- Puerto: normalmente `443`
- Túnel: desactivado
- Clave API: obligatoria
- Certificado CA: solo si el certificado pertenece a una CA privada

## Diagnóstico

- Los logs de túnel y despliegue están en `~/.MyDGX/logs/`, separados por
  identificador de perfil.
- Si el túnel no arranca, comprueba host, puerto SSH, usuario, permisos de la
  clave y que los puertos locales estén libres.
- El Tray prueba primero la dirección LAN. Solo utiliza la dirección pública y
  el puerto NAT cuando LAN no responde; el menú indica `LAN` o `Internet`.
- Si la API no responde sin túnel, comprueba firewall, protocolo, host, puerto y
  `MYDGX_API_KEY`.
- Si HTTPS falla con una CA privada, comprueba que **Certificado CA** contiene la
  CA emisora correcta, no el certificado o la clave privada del servidor.

## SECURITY NOTES:

- No guardes contraseñas, tokens, claves API ni claves privadas en el repositorio.
- Prefiere el túnel SSH o HTTPS y evita exponer MyDGX directamente a Internet.
- Usa una clave SSH dedicada por equipo y permisos `0600`.
- Mantén un identificador de credencial distinto por perfil y no reutilices su
  identificador al duplicar configuraciones manualmente.
