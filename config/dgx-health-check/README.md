# Configuración del health check DGX Spark

`./start.sh test` usa por defecto:

```text
config/dgx-health-check/dgx-spark.env
```

Si no existe, lo crea desde `dgx-spark.env.example` con permisos `0600` y se
detiene para que puedas revisarlo.

Para una prueba directa no es obligatorio editar el archivo:

```bash
./start.sh test root@192.168.1.100
./start.sh test root@192.168.1.100 -p22
./start.sh test -i ~/.ssh/clave_spark root@192.168.1.100 -p 2222
```

El puerto predeterminado es `22`. `-i` elige una clave privada, como en OpenSSH. OpenSSH intenta las claves disponibles y pide
la contraseña en la terminal únicamente si no consigue autenticar con ellas.

Variables admitidas:

- `DGX_HOST`: nombre mDNS o IP del Spark.
- `DGX_USER`: usuario creado en el primer arranque.
- `DGX_PORT`: puerto SSH.
- `DGX_IDENTITY`: ruta local opcional a una clave privada.
- `DGX_TIMEOUT`: timeout de conexión entre 1 y 30 segundos.
- `DGX_ACCEPT_NEW`: acepta claves nuevas y cambios de clave para el host:puerto
  exacto, mostrando un aviso antes de continuar.
- `DGX_EXPECT_FINGERPRINT`: huella SHA256 opcional; si se define, una diferencia
  siempre bloquea la conexión.
- `DGX_EXPECT_DISK_TB`: capacidad comprada, `1` o `4`.
- `DGX_STRICT`: convierte avisos y comprobaciones omitidas en código de salida 3.
- `DGX_INTERACTIVE`: permite que OpenSSH solicite una contraseña en la terminal.
- `DGX_HOST_KEY_ALIAS`: identidad opcional para `known_hosts`.

La precedencia es: opciones CLI, variables de entorno y archivo de configuración.

El script rechaza claves de configuración o variables llamadas
`DGX_PASSWORD`, `SSH_PASSWORD` o `PASSWORD`. No guardes contraseñas en este
directorio.

Si ya existe una clave distinta en `known_hosts`, `DGX_ACCEPT_NEW=1` reemplaza
automáticamente solo la entrada exacta de host y puerto y muestra `WARN`.
`ssh-keygen` conserva una copia `.old` del archivo anterior. Para equipos
permanentes, configura `DGX_EXPECT_FINGERPRINT` como comprobación estricta.
