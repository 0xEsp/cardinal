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
BACKUP="$ROOT_DIR/releases/product-os-data-$(date +%Y%m%d-%H%M%S)-$$.tar.gz"
tar -czf "$BACKUP" -C "$(dirname "$DATA_DIR")" "$(basename "$DATA_DIR")"
echo "Copia de datos: $BACKUP"

echo "Cargando imagen desde $ARCHIVE..."
docker load --input "$ARCHIVE"

echo "Arrancando Product OS con el contenedor recreado y sin reconstruir la imagen..."
docker compose up -d --no-build --force-recreate
trap - ERR

echo
docker compose ps
