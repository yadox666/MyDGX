# Inicio rápido: instalar MyDGX desde macOS

Esta guía está pensada para usuarios sin experiencia técnica. MyDGXTray permite
localizar un DGX Spark, preparar el acceso SSH, desplegar MyDGX y abrir sus
servicios. Solo tendrás que escribir la contraseña del Spark en Terminal cuando
macOS la solicite; MyDGXTray no la guarda.

## Resumen

1. Descarga MyDGXTray desde [Releases](https://github.com/yadox666/MyDGX/releases)
   y muévela a `Aplicaciones`.
2. En **Preferencias**, pulsa la **varita mágica**, busca el Spark y sigue el
   asistente. Escribirás una vez la contraseña del usuario del Spark.
3. Pulsa **Primer despliegue completo…** y escribe la contraseña de `sudo`.
4. Espera a **Primer despliegue terminado** y pulsa **Abrir Dashboard**.

No necesitas descargar el código fuente, instalar Homebrew ni Node.js: la
aplicación incluye MyDGX y el Spark compila lo demás.

## Antes de empezar

Necesitas:

- un Mac con macOS 13 o posterior, con Apple Silicon o Intel;
- un DGX Spark con su primer arranque oficial ya completado;
- el usuario y la contraseña creados en el Spark (el usuario debe poder usar
  `sudo`);
- ambos equipos en la misma red, o una dirección SSH remota accesible;
- conexión a Internet durante la primera instalación.

No abras los puertos del dashboard, Open WebUI o ComfyUI en el router. Para una
conexión remota basta con SSH; MyDGXTray crea los túneles necesarios.

## 1. Descarga desde GitHub

1. Abre [Releases](https://github.com/yadox666/MyDGX/releases) en GitHub.
2. Descarga `MyDGXTray-<versión>-macos-universal.zip` y, si quieres comprobar la
   descarga, también su `.sha256`.
3. Descomprímelo y mueve **MyDGXTray** a `Aplicaciones`. La aplicación ya
   incluye MyDGX: no necesitas descargar el código fuente.
4. Abre MyDGXTray. Si macOS la bloquea la primera vez, ve a **Ajustes del
   Sistema › Privacidad y seguridad** y pulsa **Abrir igualmente**.

Para comprobar la descarga desde Terminal, en la carpeta de Descargas:

```bash
shasum -a 256 -c MyDGXTray-*-macos-universal.zip.sha256
```

Debe responder `OK`. Si prefieres compilarla tú, sigue el
[README de MyDGXTray](../macos/MyDGXTray/README.md).

## 2. Añade el Spark

1. Abre **Preferencias** desde el icono de MyDGXTray.
2. Pulsa la **varita mágica**.
3. Marca **Primer arranque completado**.
4. Pulsa **Buscar en la red local**.
   - Si aparece un solo Spark, sus datos se rellenan automáticamente.
   - Si no aparece, escribe su IP o nombre de red, el usuario y el puerto SSH.
5. Pulsa **Generar par Ed25519**.
6. Pulsa **Instalar clave pública**. Se abrirá Terminal y pedirá una sola vez la
   contraseña del usuario del Spark.
7. Regresa al asistente y pulsa **Verificar acceso**.
8. Cuando aparezca la confirmación verde, pulsa **Crear perfil**.

Para un servidor remoto sigue los mismos pasos, pero usa su dominio o IP pública
y su puerto SSH. Después puedes conservar la dirección LAN en el campo interno y
añadir una **IP o hostname público** con el **puerto público/NAT** en Preferencias.
El Tray prueba primero LAN y cambia automáticamente a Internet si no responde.
Es preferible acceder mediante VPN. Si publicas SSH directamente, usa
autenticación por clave, desactiva contraseñas después de verificar el acceso y
limita el origen con el firewall.

## 3. Haz el primer despliegue

1. En Preferencias, selecciona el perfil recién creado.
2. Deja vacío **Despliegue → Proyecto local** para usar la versión incluida en
   la aplicación, y conserva `MyDGX-Dashboard` como **Directorio remoto**.
3. Pulsa **Primer despliegue completo…**.
4. Terminal mostrará la huella SSH y puede pedir confirmación. Compárala con la
   del Spark antes de aceptar.
5. Escribe la contraseña administrativa del Spark cuando `sudo` la solicite.
6. Espera a que aparezca **Primer despliegue terminado**. La instalación inicial
   puede tardar porque prepara paquetes, CUDA, llama.cpp, Docker y los servicios
   multimedia.

El despliegue genera una clave API privada en el Spark. MyDGXTray la importa
automáticamente por SSH y la guarda en `~/.MyDGX/credentials` con permisos
`0600`; nunca se imprime ni se guarda en el archivo de configuración del Tray.

## 4. Conecta y abre el dashboard

1. MyDGXTray intentará conectar automáticamente al terminar.
2. Si no lo hace, abre su menú y pulsa **Iniciar conexión**.
3. Pulsa **Abrir Dashboard**.
4. Si el administrador activó una contraseña web, introdúcela en la pantalla de
   inicio de sesión.

Desde el mismo menú puedes abrir Open WebUI, ComfyUI, Terminal SSH y las
aplicaciones web de los perfiles.

## Actualizaciones posteriores

Instala la nueva versión de MyDGXTray desde Releases, sustituyendo la anterior
en `Aplicaciones`, y usa:

**Preferencias → Despliegue → Guardar y desplegar**

Se desplegará la versión de MyDGX incluida en la nueva aplicación.

Este despliegue es incremental: conserva `.env`, bases de datos, modelos,
credenciales y cachés del Spark.

### Dirección pública estable con DuckDNS

Opcionalmente puedes definir `DUCKDNS_DOMAIN` y `DUCKDNS_TOKEN` directamente en
el `.env` del Spark y ejecutar en el Mac, desde la copia que MyDGXTray deja en
`~/.MyDGX/source` tras el primer despliegue:

```bash
cd ~/.MyDGX/source
./start.sh deploy usuario@spark -p PUERTO_SSH -i RUTA_CLAVE --duckdns --repair --interactive
```

Usa el usuario, el host, el puerto y la ruta de la clave privada que aparecen en
la sección SSH del perfil en Preferencias.

MyDGX instalará un temporizador que actualiza DuckDNS al arrancar y cada hora.
Después usa `tu-nombre.duckdns.org` como **IP o hostname público** del perfil.

## Si algo falla

- **No encuentra el Spark:** introduce manualmente la IP; comprueba que SSH esté
  activo y que ambos equipos puedan comunicarse.
- **Verificar acceso falla:** termina primero la ventana de Terminal usada para
  instalar la clave pública.
- **Undeployed:** selecciona **Primer despliegue completo…**.
- **Autenticación requerida:** espera unos segundos; el Tray sincroniza su clave
  API mediante SSH. El dashboard web puede pedir una contraseña independiente.
- **El despliegue falla:** pulsa **Abrir log** en la tarjeta de progreso.
- **El túnel no conecta:** verifica host, puerto, usuario y clave SSH en
  Preferencias.

## SECURITY NOTES

- No copies contraseñas, tokens ni claves privadas dentro del repositorio.
- No publiques directamente los puertos 8088, 3000, 4000 u 8188 en Internet.
- Verifica siempre la huella SSH en el primer acceso.
- MyDGXTray guarda las API keys en `~/.MyDGX/credentials` y las claves SSH en
  `~/.MyDGX/keys`, con permisos restrictivos.
