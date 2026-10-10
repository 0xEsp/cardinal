#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARCHIVE="${1:-}"

if [[ -z "$ARCHIVE" ]]; then
  echo "Uso: bash scripts/load-raspberry-image.sh <imagen.tar.gz>" >&2
  exit 1
fi

if [[ ! -f "$ARCHIVE" ]]; then
  echo "Error: no existe el archivo $ARCHIVE" >&2
  exit 1
fi
ARCHIVE="$(cd "$(dirname "$ARCHIVE")" && pwd)/$(basename "$ARCHIVE")"

if ! command -v docker >/dev/null 2>&1; then
  echo "Error: Docker no está instalado o no está en PATH." >&2
  exit 1
fi

cd "$ROOT_DIR"

COMPOSE_IMAGE="$(docker compose config --images)"
if [[ -z "$COMPOSE_IMAGE" || "$COMPOSE_IMAGE" == *$'\n'* ]]; then
  echo "Error: no se pudo resolver una única imagen para el servicio." >&2
  exit 1
fi

# Compose resuelve la ruta real del volumen, incluida PRODUCT_OS_DATA_DIR de
# .env. Verificarla evita recrear el contenedor contra una SQLite vacía.
DATA_DIR="$(docker compose config --format json | python3 -c '
import json, sys
config = json.load(sys.stdin)
service = config["services"]["product-os"]
matches = [v["source"] for v in service["volumes"] if v["target"] == "/app/data"]
if len(matches) != 1: raise SystemExit("Volumen /app/data no encontrado")
print(matches[0])
')"
if [[ ! -d "$DATA_DIR" ]]; then
  echo "Error: no existe el directorio persistente de datos: $DATA_DIR" >&2
  exit 1
fi
if [[ ! -f "$DATA_DIR/product-os.db" ]]; then
  echo "Error: no existe la SQLite esperada en $DATA_DIR/product-os.db; se cancela la actualización." >&2
  exit 1
fi

# Detener SQLite cierra WAL antes de copiar su directorio. El backup queda
# fuera del volumen y la nueva imagen nunca sobrescribe la base de datos.
docker compose stop product-os
restore_on_failure() {
  echo "Error durante el despliegue; intentando arrancar de nuevo el servicio." >&2
  docker compose up -d --no-build product-os || true
}
trap restore_on_failure ERR
mkdir -p "$ROOT_DIR/releases"
BACKUP_NAME="product-os-data-$(date +%Y%m%d-%H%M%S)-$$.tar.gz"
BACKUP="$ROOT_DIR/releases/$BACKUP_NAME"
# El contenedor corre como root y crea secrets/, codex/ y claude/ con 0700, que
# el usuario del host no puede leer: la copia se hace desde un contenedor con
# la imagen actual y el fichero queda 0600 y a nombre de este usuario porque
# contiene credenciales. Los CLIs de IA (cli/, cientos de MB) se reinstalan
# desde la pestaña IA y agent-work/ es temporal: no forman parte de la copia.
docker run --rm --entrypoint sh \
  -v "$DATA_DIR:/backup-src/data:ro" \
  -v "$ROOT_DIR/releases:/backup-out" \
  "$COMPOSE_IMAGE" -c "tar -czf '/backup-out/$BACKUP_NAME' --exclude=data/cli --exclude=data/agent-work -C /backup-src data \
    && chown $(id -u):$(id -g) '/backup-out/$BACKUP_NAME' && chmod 600 '/backup-out/$BACKUP_NAME'"
echo "Copia de datos: $BACKUP"

echo "Cargando imagen desde $ARCHIVE..."
LOAD_OUTPUT="$(docker load --input "$ARCHIVE")"
printf '%s\n' "$LOAD_OUTPUT"
LOADED_IMAGE="$(printf '%s\n' "$LOAD_OUTPUT" | sed -n 's/^Loaded image: //p' | tail -n 1)"
if [[ -z "$LOADED_IMAGE" ]]; then
  echo "Error: el archivo no contiene una imagen con etiqueta." >&2
  exit 1
fi
if [[ "$LOADED_IMAGE" != "$COMPOSE_IMAGE" ]]; then
  echo "Aplicando la imagen cargada a la etiqueta de Compose: $COMPOSE_IMAGE"
  docker tag "$LOADED_IMAGE" "$COMPOSE_IMAGE"
fi

echo "Arrancando Product OS con el contenedor recreado y sin reconstruir la imagen..."
docker compose up -d --no-build --force-recreate
trap - ERR

echo
docker compose ps
