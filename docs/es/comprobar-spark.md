# Cómo comprobar un DGX Spark antes de comprarlo

Esta guía permite revisar rápidamente un DGX Spark nuevo o usado antes de
aceptarlo. El test incluido en MyDGX comprueba identidad, hardware, salud y
funciones básicas por SSH.

> El resultado reduce riesgos, pero no sustituye la garantía del fabricante ni
> una prueba prolongada de carga.

## Qué necesitas

- Un Mac o equipo Linux con este repositorio descargado.
- El Spark encendido, con DGX OS iniciado y conectado a la misma red.
- El usuario SSH creado durante el primer arranque.
- La capacidad anunciada del SSD: 1 TB o 4 TB.
- Acceso físico a la consola para comprobar la huella SSH.

Antes de ejecutar software, revisa también el chasis, fuente de alimentación,
puertos, número de serie, factura y cobertura de garantía. No publiques el
número de serie.

## Prueba rápida

Desde la carpeta de MyDGX:

```bash
./start.sh test nvidia@IP_DEL_SPARK --interactive --expect-disk-tb 1
```

Sustituye:

- `nvidia` por el usuario real;
- `IP_DEL_SPARK` por su IP o hostname;
- `1` por `4` si estás comprando la versión con SSD de 4 TB.

SSH solicitará la contraseña directamente en Terminal si no existe una clave
válida. MyDGX no recibe ni guarda esa contraseña.

## Ejemplo de salida

Este es un ejemplo real anonimizado. Es más útil que un caso perfecto porque
muestra cómo el test señala incidencias que conviene investigar antes de
comprar:

```text
  ┌──────────────────────────────────────────────────────────────────┐
  │  ◆  DGX SPARK                                                   │
  │  Hardware acceptance & health check                             │
  │                                                                  │
  │  nvidia@IP_DEL_SPARK:22                                         │
  │  auth  key or terminal prompt                                   │
  └──────────────────────────────────────────────────────────────────┘

  CHECK                 DETAIL                       TIME   STATUS
  ────────────────────────────────────────────────────────────────────
  System
  ────────────────────────────────────────────────────────────────────
  Manufacturer      NVIDIA
  Product           DGX Spark
  Product version   GB10
  DGX OS            NVIDIA DGX OS 7
  Kernel            7.0.0-1025-nvidia
  Arch              aarch64
  CPU               0xd87 · 20 threads
  Memory            118.8 GiB free of 121.7 GiB unified
  Disk /            45.9 GiB used of 3.7 TiB (2%)
  Load              0.31 0.26 0.14
  Uptime            8m
  Address           [REDACTED]
  Host key          SHA256:[REDACTED]  ED25519

  GPU
  ────────────────────────────────────────────────────────────────────
  Name              NVIDIA GB10
  Driver            595.99.02
  Temperature       37 C
  Utilization       0%
  CUDA              13.2
  Memory            unified Grace pool (nvidia-smi shows N/A)

  Storage
  ────────────────────────────────────────────────────────────────────
  Root device       /dev/nvme0n1p2
  Write test        2488 MB/s (256 MiB, synced)
  Read test         11574 MB/s (256 MiB)
  NVMe SMART        PASS:SMART log readable via sudo -n
  NVMe model        SAMSUNG MZALC4T0HBL1-00B07
  Serial / firmware [REDACTED] / NXHB202Q
  NVMe temp         39 C
  Wear / spare      0% used / 100% spare (threshold 10%)
  Power-on time     8d 10h (202h total)
  Controller busy   14h 28m (868m total)
  Power cycles      68 (16 unsafe shutdowns)
  Media errors      0
  Error log entries 0

  Exercises & errors
  ────────────────────────────────────────────────────────────────────
  Memory            PASS:512 MiB allocated and verified
  Disk I/O          PASS:256 MiB write/read completed
  CUDA compute      PASS:NVIDIA GB10
  Max system temp   41 C (acpitz)
  NVIDIA Xid        0
  Boot errors       44

  Notes
  ────────────────────────────────────────────────────────────────────
  · WARN: The current boot journal contains 44 error-level message(s).
  · NVMe lifetime records 16 unsafe shutdown(s); monitor whether this increases.

  ────────────────────────────────────────────────────────────────────
  Result            ATTENTION
  Summary           7 transport checks, 0 failed; 0 hardware failures, 1 warnings
  Elapsed           346s
  Next              Core checks passed, but review the warnings above.
```

En este ejemplo, la marca y modelo principales son **NVIDIA DGX Spark / GB10**,
el SSD es un **Samsung MZALC4T0HBL1-00B07 de 4 TB** y registra **202 horas de
uso**. La GPU, CUDA, memoria, disco y SMART pasan las pruebas, sin desgaste ni
errores de medios. Sin embargo, el resultado es `ATTENTION`: hay 44 mensajes de
error del arranque y 16 apagados inseguros. Antes de comprar habría que revisar
`journalctl -b -p 0..3`, repetir la prueba tras un reinicio limpio y confirmar
que ambos contadores no aumentan.

Un resultado `HEALTHY` y cero avisos es la referencia deseable. Si aparece
`ATTENTION`, `WARN`, `FAIL` o `SKIP`, revisa siempre el detalle.

Antes de comprar, presta especial atención a **Manufacturer**, **Product**,
**Name** de la GPU, memoria total, capacidad y **NVMe model**, **Power-on time**,
desgaste, apagados inseguros, errores de medios y el resultado final. Las horas
de uso no deben confundirse con `Uptime`: `Power-on time` es el uso acumulado
del SSD, mientras que `Uptime` solo mide el tiempo desde el último arranque.

## Verifica primero la identidad del equipo

En la consola local del Spark ejecuta:

```bash
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
```

Copia únicamente la huella `SHA256:...` y fija la prueba:

```bash
./start.sh test nvidia@IP_DEL_SPARK \
  --interactive \
  --expect-fingerprint SHA256:HUELLA_VERIFICADA \
  --expect-disk-tb 1 \
  --strict
```

No aceptes una huella recibida por la red sin compararla con la consola del
Spark. Para una unidad alquilada o recién reinstalada también existe
`--accept-new`, pero debes verificar la huella antes.

## Descubrimiento automático en una red local

Si no conoces la dirección:

```bash
./start.sh test --autodiscover
```

El asistente busca servicios SSH anunciados como DGX, Spark o NVIDIA y crea una
configuración local en:

```text
config/dgx-health-check/dgx-spark.env
```

Ese archivo tiene permisos `0600` y está excluido de Git. Revísalo y ejecuta:

```bash
./start.sh test --strict
```

## Qué comprueba

- DGX OS, arquitectura ARM64 y GPU NVIDIA GB10.
- Memoria unificada y capacidad de almacenamiento esperada.
- Kernel, driver y CUDA.
- Temperaturas y errores NVIDIA Xid recientes.
- Identidad y salud SMART del NVMe cuando están disponibles.
- Errores de medios, desgaste, horas de uso y apagados inseguros.
- Ejercicio de memoria de 512 MiB.
- Escritura y lectura temporal de 256 MiB en el directorio del usuario.
- Cálculo CUDA breve mediante PyTorch o un kernel CUDA nativo.

El archivo temporal se elimina al terminar. El test no escribe directamente en
dispositivos de bloques ni modifica modelos o datos del usuario.

## Cómo interpretar el resultado

- **HEALTHY**: comprobaciones principales correctas.
- **ATTENTION**: el hardware básico responde, pero debes revisar cada aviso.
- **HARDWARE CHECK FAILED**: no aceptes la unidad sin diagnosticar los fallos.
- **AUTH FAILED** o **FAILED**: falló acceso, red o preparación; no demuestra por
  sí solo un defecto del hardware.

Con `--strict`, cualquier aviso o comprobación omitida produce error. Es la
opción recomendada antes de comprar.

Señales especialmente importantes:

- GPU distinta de GB10 o memoria muy inferior a 128 GB.
- SSD menor que la capacidad anunciada.
- `critical warning`, errores de medios o desgaste NVMe elevado.
- Errores Xid, temperaturas anómalas o fallos CUDA.
- Fallos en los ejercicios de memoria o disco.

Algunas comprobaciones pueden aparecer como `SKIP` si faltan `nvme-cli`,
permisos SMART o PyTorch. No instales nada en una unidad ajena sin permiso del
vendedor. Si lo autoriza, `--prepare` instala herramientas de diagnóstico y
puede descargar varios GB:

```bash
./start.sh test nvidia@IP_DEL_SPARK --interactive --prepare --strict
```

## Guarda evidencia

Puedes conservar la salida sin códigos de color:

```bash
./start.sh test nvidia@IP_DEL_SPARK \
  --interactive \
  --expect-disk-tb 1 \
  --strict \
  --no-color | tee prueba-dgx-spark.txt
```

Revisa el informe antes de pagar. Para una unidad usada, pide además tiempo para
una prueba prolongada y confirma por separado la garantía.

## SECURITY NOTES

- Nunca escribas contraseñas en argumentos, archivos o variables.
- Verifica la huella SSH desde la consola física.
- Usa una red de confianza y elimina después cualquier clave temporal autorizada.
- El informe puede contener hostname, IP, modelo y datos del NVMe; no lo
  publiques sin revisarlo.
