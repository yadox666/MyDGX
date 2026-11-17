# Conversión segura a modo servidor

MyDGX incluye una operación para convertir una instalación Ubuntu/DGX OS de
escritorio en un sistema sin sesión gráfica. La entrada pública es
`./start.sh serverize` y delega el trabajo en `scripts/serverize-os.sh`.

La operación está diseñada para conservar la función de cómputo y administración
del equipo: los dos kernels más recientes, el kernel en ejecución si es más
antiguo que esos dos, firmware, drivers NVIDIA, CUDA, red, SSH, Avahi/mDNS,
Docker, Ollama y los servicios de MyDGX. Los kernels anteriores, y los paquetes
ligados a esa versión, se retiran al aplicar.

## Auditoría sin cambios

El modo predeterminado solo consulta `dpkg`, APT, Snap y systemd. Construye la
lista de candidatos, simula la resolución completa de APT y rechaza el plan si
aparece un paquete protegido.

```bash
./start.sh serverize
```

También puede indicarse explícitamente:

```bash
./start.sh serverize --audit
```

La auditoría también muestra qué kernels se conservarían y qué paquetes de
versiones anteriores se purgarían. No necesita privilegios de administrador y
no desinstala paquetes, detiene servicios, cambia el target de systemd ni
escribe estado en `/var`.

## Fase inicial: solo desactivar

Esta opción reduce el uso de memoria sin borrar aplicaciones, paquetes, snaps ni
datos. Es reversible y no libera espacio en disco:

```bash
sudo ./start.sh serverize \
  --disable \
  --confirm DISABLE-DESKTOP-SERVICES
```

La fase inicial:

- cambia el arranque predeterminado a `multi-user.target`;
- habilita la consola de texto `tty1`;
- detiene y deshabilita GDM/display manager, Bluetooth, impresión,
  ModemManager, `switcheroo-control`, `colord` y `whoopsie` cuando existen;
- conserva red, SSH, Avahi, NVIDIA/CUDA, Docker, Ollama y MyDGX;
- guarda el estado anterior bajo `/var/lib/mydgx/serverize/`;
- no invoca `apt remove`, `apt purge`, `autoremove` ni `snap remove`.

Los procesos detenidos liberan memoria inmediatamente; no hace falta reiniciar.
El siguiente arranque también será en consola.

Ejecuta esta operación desde SSH o una TTY. El script rechaza sesiones marcadas
como X11 o Wayland para no cerrar su propia terminal gráfica durante el cambio.

Para reactivar el escritorio sin reinstalar nada:

```bash
sudo systemctl set-default graphical.target
sudo systemctl enable --now gdm3.service
```

Los demás servicios deshabilitados pueden restaurarse selectivamente consultando
`enabled-services-before.txt` en el directorio de estado creado por la operación.

## Aplicación

Revisa siempre la auditoría antes de aplicar. La conversión exige root y una
confirmación literal para evitar ejecuciones accidentales:

```bash
sudo ./start.sh serverize \
  --apply \
  --confirm CONVERT-TO-HEADLESS-SERVER
```

El script:

1. verifica la consistencia de `dpkg` y APT;
2. vuelve a simular el plan y comprueba la lista protegida;
3. guarda el inventario previo;
4. marca los componentes críticos para que APT no los trate como huérfanos;
5. configura `multi-user.target` y habilita la consola `tty1`;
6. retira aplicaciones, metapaquetes y servicios de escritorio;
7. ejecuta `autoremove --purge` únicamente sobre el plan validado;
8. purga los kernels anteriores a los dos más recientes, junto con headers,
   módulos, herramientas y módulos NVIDIA de esa misma versión;
9. verifica que los servicios previamente activos siguen funcionando, que
   `nvidia-smi` responde y que siguen instalados el kernel en ejecución y el
   otro kernel conservado.

No reinicia el equipo. El reinicio y la comprobación de la consola HDMI quedan
como acciones separadas y deliberadas.

## Qué se elimina

Los candidatos se calculan sobre los paquetes realmente instalados. Incluyen:

- GNOME, GDM, sesiones, extensiones, portales y utilidades gráficas;
- LibreOffice, Firefox, Thunderbird y aplicaciones multimedia o de oficina;
- herramientas de escritorio de red, archivos, copia, impresión y escaneo;
- Snap Store y snaps de escritorio conocidos;
- Bluetooth, impresión, ModemManager, color y telemetría de escritorio cuando
  están instalados;
- metapaquetes y personalizaciones NVIDIA/DGX exclusivos del escritorio;
- kernels más antiguos que los dos últimos, con sus paquetes `linux-*` de esa
  versión: imagen, headers, modules, tools y módulos NVIDIA asociados.

Los snaps ajenos al escritorio no se eliminan. `snapd` se conserva porque forma
parte de las dependencias de Ubuntu Server.

## Qué se conserva

La protección cubre expresamente:

- los dos kernels más recientes y, si no está entre ellos, el kernel en
  ejecución; también su initrd, módulos y paquetes de esa versión;
- metapaquetes `linux-*-hwe-*`, firmware, systemd, arranque y `dgxstation-grub`;
- drivers, módulos, utilidades y bibliotecas NVIDIA;
- CUDA, cuDNN y TensorRT;
- NetworkManager, Netplan, SSH y Avahi;
- Docker, containerd y Ollama;
- paquetes base de Ubuntu Server;
- Python y herramientas esenciales usadas por MyDGX.

Avahi permanece activo porque la administración mediante nombres `.local`
depende de mDNS.

### Componentes X conservados

El sistema deja de iniciar GDM, GNOME y X, pero puede conservar paquetes como
`xserver-xorg-core` y `xserver-xorg-video-nvidia-*`. Los metapaquetes oficiales
del driver NVIDIA dependen de ellos. Quitarlos también retiraría el controlador
de cómputo y perjudicaría futuras actualizaciones.

Esos componentes quedan instalados pero inactivos; el target de arranque es
`multi-user.target`.

## Kernels antiguos

`--audit` lista las imágenes instaladas y marca cada una como conservada o
eliminable. `--disable` no desinstala kernels. `--apply` sí purga los antiguos
después de validar el plan.

La selección es:

- se ordenan las imágenes `linux-image-<versión>-<sabor>` instaladas;
- se conservan las dos versiones más altas;
- si el kernel en ejecución es más antiguo que esas dos, también se conserva,
  de modo que el sistema nunca se queda sin el kernel que está cargado;
- con uno o dos kernels instalados no se elimina ninguno.

De cada versión eliminada se retiran los paquetes `linux-*` cuyo nombre
contiene su ABI. En un DGX Spark eso incluye, por ejemplo,
`linux-image-6.11.0-1016-nvidia`, `linux-headers-6.11.0-1016-nvidia`,
`linux-tools-6.11.0-1016-nvidia`, `linux-modules-nvidia-fs-6.11.0-1016-nvidia`
y `linux-nvidia-6.11-tools-6.11.0-1016`.

No entran en esa lista el firmware, CUDA, los drivers NVIDIA de usuario ni los
metapaquetes que siguen al kernel HWE, como
`linux-image-nvidia-hwe-24.04` o `linux-modules-nvidia-595-open-nvidia-hwe-24.04`.

Antes de purgar, el script simula `apt-get purge` y aborta si APT intenta
retirar cualquier paquete que no esté en la lista. El kernel en ejecución
permanece cargado. La desinstalación regenera GRUB, pero el script no reinicia.

## Estado previo y recuperación

Antes de modificar paquetes se crea un directorio con fecha UTC bajo:

```text
/var/lib/mydgx/serverize/
```

Contiene el inventario de `dpkg`, paquetes marcados manualmente, target anterior,
servicios habilitados y activos, snaps, candidatos y simulación de APT. Los
archivos solo son accesibles por root.

### Informe JSON local

Al terminar correctamente `--disable` o `--apply`, el script confirma el
resultado con un resumen legible:

```text
Has liberado 1,80 GiB de memoria RAM y 6,25 GiB de espacio en disco.
```

Después muestra la ubicación del informe detallado, creado como:

```text
data/serverize-FECHA-OPERACION.json
```

El informe contiene:

- bytes usados en disco antes y después, diferencia y espacio liberado;
- memoria total y disponible antes y después, con su diferencia;
- cantidad de paquetes y snaps instalados antes y después;
- target de systemd anterior y actual;
- servicios seleccionados activos antes y después, y cuáles se desactivaron;
- modo ejecutado, hora de finalización y ruta del inventario previo;
- kernel en ejecución, kernels conservados y, solo en `--apply`, versiones y
  paquetes de kernel retirados.

El informe usa `schema_version` 2. Un informe antiguo de versión 1 no incluye
el objeto `kernels`.

Las métricas de disco describen el sistema de archivos que contiene MyDGX. La
memoria disponible puede variar ligeramente por actividad concurrente, por lo
que su diferencia es una observación del sistema y no una contabilidad exclusiva
de cada proceso.

El JSON tiene permisos de lectura local y no contiene variables de entorno,
credenciales, claves, tokens ni contenido de archivos de configuración.

No existe una restauración automática, porque versiones y repositorios pueden
cambiar. Para recuperar el escritorio, revisa primero el inventario guardado y
reinstala los metapaquetes disponibles para esa versión de DGX OS. Como mínimo,
la recuperación suele requerir:

```bash
sudo apt-get install ubuntu-desktop nvidia-system-station
sudo systemctl set-default graphical.target
```

Reinicia únicamente después de comprobar que APT terminó sin errores y que el
driver NVIDIA continúa operativo.

## Verificación posterior

Después de aplicar, y antes de reiniciar:

```bash
systemctl get-default
systemctl is-active ssh NetworkManager avahi-daemon docker mydgx
nvidia-smi
```

Tras el reinicio, HDMI debe mostrar una consola de texto en `tty1`. También debe
seguir disponible el acceso SSH y la interfaz web de MyDGX.

## Notas de seguridad

- Ejecuta la aplicación desde una consola local o con acceso alternativo al
  equipo, aunque SSH esté protegido por el script.
- No modifiques la lista de paquetes protegidos sin volver a simular APT.
- La limpieza de kernels no sustituye esa simulación: si el plan de `apt-get
  purge` incluye un paquete que no pertenece a un kernel antiguo, la operación
  se detiene antes de desinstalar.
- El script no lee, copia ni muestra `.env`, claves SSH, tokens o credenciales.
- No uses `--apply` durante actualizaciones de APT, instalaciones de drivers o
  reparaciones de `dpkg`.
